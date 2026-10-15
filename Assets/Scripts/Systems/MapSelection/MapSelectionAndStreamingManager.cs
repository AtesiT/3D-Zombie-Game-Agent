using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace ZombieSurvival.Systems.MapSelection
{
    /// <summary>
    /// Manages the Map Catalog, Pre-Match Lobby UI Selection State, and Seamless Asynchronous
    /// Scene Streaming pipeline (Base Gameplay Scene + Additive Sub-Scenes + Mechanic Bootstrap).
    /// </summary>
    public class MapSelectionAndStreamingManager : MonoBehaviour
    {
        public static MapSelectionAndStreamingManager Instance { get; private set; }

        [Header("Map Catalog")]
        [SerializeField] private List<MapDefinitionSO> availableMaps = new List<MapDefinitionSO>();
        [SerializeField] private string persistentCoreSceneName = "Scene_PersistentCore";

        [Header("Streaming Settings")]
        [Tooltip("Minimum display time for the transition screen to prevent jarring single-frame flashes.")]
        [SerializeField] private float minimumTransitionDisplaySeconds = 1.25f;

        public event Action<MapDefinitionSO> OnMapPreviewSelected;
        public event Action<MapDefinitionSO> OnMapLoadStarted;
        public event Action<float, string> OnMapLoadProgressUpdated;
        public event Action<MapDefinitionSO> OnMapLoadCompleted;
        public event Action<string> OnMapLoadFailed;

        public IReadOnlyList<MapDefinitionSO> AvailableMaps => availableMaps;
        public MapDefinitionSO SelectedMap { get; private set; }
        public bool IsStreamingInProgress { get; private set; }

        private readonly List<string> _currentlyLoadedMapScenes = new List<string>();

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);

            if (availableMaps.Count > 0 && SelectedMap == null)
            {
                SelectMapForPreview(0);
            }
        }

        /// <summary>
        /// Called by the Map Selection UI Carousel/Grid when a player highlights or clicks a map card.
        /// Updates preview metadata, minimap preview, and crossfades the lobby audio preview stem.
        /// </summary>
        public bool SelectMapForPreview(int index)
        {
            if (IsStreamingInProgress || index < 0 || index >= availableMaps.Count)
                return false;

            MapDefinitionSO candidate = availableMaps[index];
            if (candidate == null)
                return false;

            SelectedMap = candidate;
            OnMapPreviewSelected?.Invoke(SelectedMap);
            return true;
        }

        /// <summary>
        /// Selects a map by its unique string identifier (e.g., "map_terminal_transit").
        /// </summary>
        public bool SelectMapById(string mapId)
        {
            if (IsStreamingInProgress || string.IsNullOrWhiteSpace(mapId))
                return false;

            for (int i = 0; i < availableMaps.Count; i++)
            {
                if (availableMaps[i] != null &&
                    string.Equals(availableMaps[i].MapId, mapId, StringComparison.OrdinalIgnoreCase))
                {
                    return SelectMapForPreview(i);
                }
            }
            return false;
        }

        /// <summary>
        /// Launches the match into the currently selected map using asynchronous scene streaming.
        /// </summary>
        public void ConfirmAndLaunchSelectedMap()
        {
            if (IsStreamingInProgress)
            {
                Debug.LogWarning("[MapSelectionManager] Scene streaming is already in progress.");
                return;
            }

            if (SelectedMap == null)
            {
                OnMapLoadFailed?.Invoke("No map is currently selected.");
                return;
            }

            StartCoroutine(StreamMapRoutine(SelectedMap));
        }

        private IEnumerator StreamMapRoutine(MapDefinitionSO targetMap)
        {
            IsStreamingInProgress = true;
            float startTime = Time.realtimeSinceStartup;
            OnMapLoadStarted?.Invoke(targetMap);

            // Step 1: Unload any previously active map scenes
            if (_currentlyLoadedMapScenes.Count > 0)
            {
                OnMapLoadProgressUpdated?.Invoke(0.05f, "Unloading previous sector...");
                for (int i = _currentlyLoadedMapScenes.Count - 1; i >= 0; i--)
                {
                    string sceneToUnload = _currentlyLoadedMapScenes[i];
                    if (SceneManager.GetSceneByName(sceneToUnload).isLoaded)
                    {
                        AsyncOperation unloadOp = SceneManager.UnloadSceneAsync(sceneToUnload);
                        while (unloadOp != null && !unloadOp.isDone)
                        {
                            yield return null;
                        }
                    }
                }
                _currentlyLoadedMapScenes.Clear();

                // Clean up orphaned assets & run GC during masked transition screen
                AsyncOperation cleanupOp = Resources.UnloadUnusedAssets();
                while (cleanupOp != null && !cleanupOp.isDone)
                {
                    yield return null;
                }
                GC.Collect();
            }

            // Step 2: Load Primary Map Scene additively
            string primarySceneName = targetMap.GameplaySceneName;
            OnMapLoadProgressUpdated?.Invoke(0.15f, $"Loading {targetMap.DisplayName}...");

            AsyncOperation primaryLoadOp = SceneManager.LoadSceneAsync(primarySceneName, LoadSceneMode.Additive);
            if (primaryLoadOp == null)
            {
                IsStreamingInProgress = false;
                OnMapLoadFailed?.Invoke($"Failed to start async load for scene '{primarySceneName}'.");
                yield break;
            }

            primaryLoadOp.allowSceneActivation = false;
            while (primaryLoadOp.progress < 0.9f)
            {
                float normalizedProgress = Mathf.Lerp(0.15f, 0.65f, primaryLoadOp.progress / 0.9f);
                OnMapLoadProgressUpdated?.Invoke(normalizedProgress, $"Streaming geometry ({Mathf.RoundToInt(normalizedProgress * 100f)}%)...");
                yield return null;
            }

            primaryLoadOp.allowSceneActivation = true;
            while (!primaryLoadOp.isDone)
            {
                yield return null;
            }

            _currentlyLoadedMapScenes.Add(primarySceneName);
            Scene loadedPrimaryScene = SceneManager.GetSceneByName(primarySceneName);
            if (loadedPrimaryScene.IsValid())
            {
                SceneManager.SetActiveScene(loadedPrimaryScene);
            }

            // Step 3: Stream Additive Sub-Scenes (Lighting, Props, NavMesh chunks)
            IReadOnlyList<string> subScenes = targetMap.AdditiveSubSceneNames;
            if (subScenes != null && subScenes.Count > 0)
            {
                for (int i = 0; i < subScenes.Count; i++)
                {
                    string subScene = subScenes[i];
                    if (string.IsNullOrWhiteSpace(subScene)) continue;

                    OnMapLoadProgressUpdated?.Invoke(
                        Mathf.Lerp(0.65f, 0.88f, (float)i / subScenes.Count),
                        $"Streaming sub-sector {i + 1}/{subScenes.Count}...");

                    AsyncOperation subOp = SceneManager.LoadSceneAsync(subScene, LoadSceneMode.Additive);
                    if (subOp != null)
                    {
                        while (!subOp.isDone)
                        {
                            yield return null;
                        }
                        _currentlyLoadedMapScenes.Add(subScene);
                    }
                }
            }

            // Step 4: Apply Skybox, GI lighting & initialize unique Map Mechanic Modules
            OnMapLoadProgressUpdated?.Invoke(0.92f, "Initializing map mechanics & weather systems...");
            ApplyMapVisualAndMechanicBootstrap(targetMap, loadedPrimaryScene);

            // Step 5: Enforce smooth minimum transition time so UI animations complete cleanly
            float elapsed = Time.realtimeSinceStartup - startTime;
            if (elapsed < minimumTransitionDisplaySeconds)
            {
                yield return new WaitForSecondsRealtime(minimumTransitionDisplaySeconds - elapsed);
            }

            OnMapLoadProgressUpdated?.Invoke(1.0f, "Deployment Ready.");
            IsStreamingInProgress = false;
            OnMapLoadCompleted?.Invoke(targetMap);
        }

        private void ApplyMapVisualAndMechanicBootstrap(MapDefinitionSO map, Scene activeScene)
        {
            if (map.SkyboxMaterial != null)
            {
                RenderSettings.skybox = map.SkyboxMaterial;
                DynamicGI.UpdateEnvironment();
            }

            GameObject[] rootObjects = activeScene.IsValid() ? activeScene.GetRootGameObjects() : Array.Empty<GameObject>();
            GameObject mapRoot = rootObjects.Length > 0 ? rootObjects[0] : gameObject;

            IReadOnlyList<MapMechanicProfileSO> mechanics = map.UniqueMechanics;
            if (mechanics != null)
            {
                for (int i = 0; i < mechanics.Count; i++)
                {
                    if (mechanics[i] != null)
                    {
                        mechanics[i].InitializeMechanic(mapRoot);
                    }
                }
            }
        }
    }
}
