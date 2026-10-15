using System;
using System.Collections.Generic;
using UnityEngine;
using ZombieSurvival.Core;

namespace ZombieSurvival.Systems.MapSelection
{
    /// <summary>
    /// Weighted weather entry used by each map to define climate-specific weather probabilities
    /// (e.g., Neon Night Market favors HeavyRain/Thunderstorm; Blackwood Logging favors DenseFog/Snow).
    /// </summary>
    [Serializable]
    public struct MapWeatherWeight
    {
        public WeatherType Weather;
        [Range(0f, 100f)] public float SelectionWeight;
        [Tooltip("Min/Max duration in seconds when this weather state rolls on this map.")]
        public Vector2 DurationSecondsRange;
    }

    /// <summary>
    /// Base polymorphic ScriptableObject representing a map-specific environmental mechanic module.
    /// Allows maps to compose unique mechanics without hardcoding map IDs into game managers.
    /// </summary>
    public abstract class MapMechanicProfileSO : ScriptableObject
    {
        [SerializeField] private string mechanicTitle;
        [TextArea(2, 4)]
        [SerializeField] private string mechanicDescription;

        public string MechanicTitle => mechanicTitle;
        public string MechanicDescription => mechanicDescription;

        /// <summary>
        /// Invoked by the MapBootstrapManager once the map scene finishes streaming in.
        /// </summary>
        public abstract void InitializeMechanic(GameObject mapRoot);
    }

    /// <summary>
    /// Map 1 ("Terminal Transit") Mechanic Profile: Armored Transit Bus + Roof Turret + Route Stops.
    /// </summary>
    [CreateAssetMenu(fileName = "Mechanic_TerminalTransit", menuName = "ZombieSurvival/Maps/Mechanics/Terminal Transit Bus")]
    public class TerminalTransitMechanicSO : MapMechanicProfileSO
    {
        [Header("Armored Bus Spawn & Route Settings")]
        public GameObject ArmoredBusPrefab;
        public float InitialFuelCapacity = 100f;
        public float FuelConsumptionPerSecondDriving = 4.5f;
        public float PassiveSolarRechargePerSecond = 2.0f;
        public float EmergencyCooldownSeconds = 12f;

        [Header("Roof Mounted Turret")]
        public float TurretRoundsPerMinute = 650f;
        public float TurretHeatPerShot = 0.045f;
        public float TurretOverheatCooldownSeconds = 4.0f;

        public override void InitializeMechanic(GameObject mapRoot)
        {
            Debug.Log($"[TerminalTransitMechanicSO] Initialized Armored Bus & Turret systems on {mapRoot.name}.");
        }
    }

    /// <summary>
    /// Map 2 ("Neon Night Market") Mechanic Profile: Destructible Neon Signs, Tight Grenade Bounce Alleys,
    /// and Multi-Tier Fire Escape Verticality.
    /// </summary>
    [CreateAssetMenu(fileName = "Mechanic_NeonNightMarket", menuName = "ZombieSurvival/Maps/Mechanics/Neon Night Market")]
    public class NeonNightMarketMechanicSO : MapMechanicProfileSO
    {
        [Header("Destructible Neon Sign Hazards")]
        public float SignAnchorHealth = 75f;
        public float FallingSignImpactDamage = 450f;
        public float ElectrifiedPuddleDuration = 14f;
        public float ElectricalShockDamagePerTick = 35f;
        public float RainPuddleRadiusBonusMultiplier = 1.65f; // Rain expands electrical puddles!

        [Header("Fire Escape Verticality")]
        public float ElevatedDamageBonusMultiplier = 1.15f;
        public float ZombieClimbDurationSeconds = 2.8f;

        public override void InitializeMechanic(GameObject mapRoot)
        {
            Debug.Log($"[NeonNightMarketMechanicSO] Initialized Neon Hazards & Fire Escape Verticality on {mapRoot.name}.");
        }
    }

    /// <summary>
    /// Map 3 ("Blackwood Logging Camp") Mechanic Profile: Bear Traps, Destructible Falling Trees,
    /// High-Speed Escape Ziplines, and Mud Slowdown Zones.
    /// </summary>
    [CreateAssetMenu(fileName = "Mechanic_BlackwoodLogging", menuName = "ZombieSurvival/Maps/Mechanics/Blackwood Logging Camp")]
    public class BlackwoodLoggingMechanicSO : MapMechanicProfileSO
    {
        [Header("Bear Traps")]
        public float BearTrapZombieDamage = 300f;
        public float BearTrapPlayerDamage = 35f;
        public float BearTrapRootDuration = 3.5f;
        public int BearTrapRearmCostPoints = 250;

        [Header("Destructible Timber / Falling Trees")]
        public float TreeSupportWeakpointHealth = 120f;
        public float FallingLogSweepLength = 14f;
        public float FallingLogCrushDamage = 1200f;
        public float NavMeshLogObstacleLifetime = 45f;

        [Header("Escape Ziplines & Mud Patches")]
        public float ZiplineTravelSpeed = 18f;
        public float ZiplineCooldownSeconds = 20f;
        [Range(0.2f, 1f)] public float MudPlayerSpeedMultiplier = 0.58f;
        [Range(0.2f, 1f)] public float MudZombieSpeedMultiplier = 0.65f;

        public override void InitializeMechanic(GameObject mapRoot)
        {
            Debug.Log($"[BlackwoodLoggingMechanicSO] Initialized Bear Traps, Timber Physics, Ziplines & Mud on {mapRoot.name}.");
        }
    }

    /// <summary>
    /// Primary ScriptableObject data container defining a playable survival map.
    /// Supports both Inspector authoring and JSON export/import via MapMetadataDTO.
    /// </summary>
    [CreateAssetMenu(fileName = "MapDef_NewMap", menuName = "ZombieSurvival/Maps/Map Definition")]
    public class MapDefinitionSO : ScriptableObject
    {
        [Header("Identity & UI Metadata")]
        [SerializeField] private string mapId = "map_terminal_transit";
        [SerializeField] private string displayName = "Terminal Transit";
        [SerializeField] private string subtitle = "Abandoned Metro Hub & Highway Loop";
        [TextArea(3, 6)]
        [SerializeField] private string description;
        [Range(1, 5)]
        [SerializeField] private int difficultySkullRating = 3;
        [SerializeField] private int recommendedMaxPlayers = 4;
        [SerializeField] private bool isUnlockedByDefault = true;

        [Header("Scene & Streaming Configuration")]
        [SerializeField] private string gameplaySceneName = "Scene_Map_TerminalTransit";
        [SerializeField] private string[] additiveSubSceneNames;

        [Header("Visuals, Lighting & Audio Assets")]
        [SerializeField] private Sprite previewThumbnail;
        [SerializeField] private Texture2D tacticalMinimapTexture;
        [SerializeField] private Material skyboxMaterial;
        [SerializeField] private AudioClip lobbyPreviewTheme;
        [SerializeField] private AudioClip ambientLoopStem;
        [SerializeField] private AudioClip highWaveCombatMusic;

        [Header("Initial Time & Weather Table")]
        [Range(0f, 1f)]
        [SerializeField] private float startingNormalizedTime = 0.35f;
        [SerializeField] private float dayCycleDurationSeconds = 480f;
        [SerializeField] private List<MapWeatherWeight> weatherProbabilityTable = new List<MapWeatherWeight>();

        [Header("Unique Map Mechanics (Polymorphic Modules)")]
        [SerializeField] private List<MapMechanicProfileSO> uniqueMechanics = new List<MapMechanicProfileSO>();

        // Public Read-Only Accessors
        public string MapId => mapId;
        public string DisplayName => displayName;
        public string Subtitle => subtitle;
        public string Description => description;
        public int DifficultySkullRating => difficultySkullRating;
        public int RecommendedMaxPlayers => recommendedMaxPlayers;
        public bool IsUnlockedByDefault => isUnlockedByDefault;
        public string GameplaySceneName => gameplaySceneName;
        public IReadOnlyList<string> AdditiveSubSceneNames => additiveSubSceneNames;
        public Sprite PreviewThumbnail => previewThumbnail;
        public Texture2D TacticalMinimapTexture => tacticalMinimapTexture;
        public Material SkyboxMaterial => skyboxMaterial;
        public AudioClip LobbyPreviewTheme => lobbyPreviewTheme;
        public AudioClip AmbientLoopStem => ambientLoopStem;
        public AudioClip HighWaveCombatMusic => highWaveCombatMusic;
        public float StartingNormalizedTime => startingNormalizedTime;
        public float DayCycleDurationSeconds => dayCycleDurationSeconds;
        public IReadOnlyList<MapWeatherWeight> WeatherProbabilityTable => weatherProbabilityTable;
        public IReadOnlyList<MapMechanicProfileSO> UniqueMechanics => uniqueMechanics;

        /// <summary>
        /// Exports non-asset metadata to a JSON string for cloud config overrides or modding support.
        /// </summary>
        public string ToJsonDTO()
        {
            var dto = new MapMetadataDTO
            {
                mapId = this.mapId,
                displayName = this.displayName,
                subtitle = this.subtitle,
                description = this.description,
                difficultyRating = this.difficultySkullRating,
                gameplaySceneName = this.gameplaySceneName,
                startingNormalizedTime = this.startingNormalizedTime,
                dayCycleDurationSeconds = this.dayCycleDurationSeconds,
                weatherTable = this.weatherProbabilityTable.ToArray()
            };
            return JsonUtility.ToJson(dto, prettyPrint: true);
        }

        [Serializable]
        public struct MapMetadataDTO
        {
            public string mapId;
            public string displayName;
            public string subtitle;
            public string description;
            public int difficultyRating;
            public string gameplaySceneName;
            public float startingNormalizedTime;
            public float dayCycleDurationSeconds;
            public MapWeatherWeight[] weatherTable;
        }
    }
}
