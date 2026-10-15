using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Audio;
using ZombieSurvival.Core;
using ZombieSurvival.Systems.MapSelection;

namespace ZombieSurvival.Systems.Environment
{
    /// <summary>
    /// Configuration profile for a single WeatherType, defining both visual/audio presentation
    /// parameters and concrete gameplay modifiers.
    /// </summary>
    [CreateAssetMenu(fileName = "WeatherProfile_New", menuName = "ZombieSurvival/Environment/Weather Profile")]
    public class WeatherProfileSO : ScriptableObject
    {
        public WeatherType WeatherType = WeatherType.Clear;

        [Header("Physics & Movement Modifiers")]
        [Range(0.25f, 1.2f)] public float SurfaceFrictionMultiplier = 1.0f;
        [Range(0.5f, 1.2f)] public float PlayerMoveSpeedMultiplier = 1.0f;
        [Range(0.5f, 2.2f)] public float VehicleDriftSlipMultiplier = 1.0f;
        [Range(0.5f, 1.3f)] public float ZombieMoveSpeedMultiplier = 1.0f;

        [Header("Top-Down Vision & Spawner Modifiers")]
        [Range(8f, 50f)] public float BaseTopDownVisionRadius = 38f;
        [Range(8f, 45f)] public float MinZombieSpawnDistance = 34f;
        [Range(0f, 1f)] public float ScreenOverlayIntensity = 0f;
        public bool ForcePlayerFlashlights = false;

        [Header("Audio Occlusion & Surface Tracks")]
        [Range(600f, 22000f)] public float AudioLowPassCutoffHz = 22000f;
        public bool LeaveFootprintAndTireTracks = false;

        [Header("Thunderstorm Hazard Parameters")]
        public bool EnableLightningStrikes = false;
        public Vector2 LightningIntervalSeconds = new Vector2(6f, 13f);
        public float LightningTelegraphSeconds = 1.65f;
        public float LightningBlastRadius = 4.2f;
        public float LightningZombieDamage = 650f;
        public float LightningPlayerDamage = 45f;

        [Header("RenderSettings Fog")]
        public Color FogColor = new Color(0.18f, 0.22f, 0.26f, 1f);
        [Range(0f, 0.12f)] public float ExponentialFogDensity = 0.008f;
    }

    /// <summary>
    /// Central orchestrator for the Dynamic Weather State Machine and Day/Night Cycle.
    /// Computes a unified EnvironmentGameplaySnapshot and broadcasts it across Physics, AI,
    /// Camera Vision, Audio Mixer, and Wave Spawner systems.
    /// </summary>
    public class EnvironmentDirector : MonoBehaviour
    {
        public static EnvironmentDirector Instance { get; private set; }

        [Header("Weather Profiles (Clear, HeavyRain, DenseFog, Thunderstorm, Snow)")]
        [SerializeField] private List<WeatherProfileSO> weatherProfiles = new List<WeatherProfileSO>();
        [SerializeField] private float weatherTransitionDuration = 6.0f;

        [Header("Day / Night Cycle Settings")]
        [SerializeField] private bool advanceTimeContinuously = true;
        [SerializeField] private float fullDayCycleDurationSeconds = 480f;
        [Range(0f, 1f)]
        [SerializeField] private float currentNormalizedTime = 0.35f; // 0=Midnight, 0.25=Dawn, 0.5=Noon, 0.75=Dusk
        [SerializeField] private float waveProgressionTimeStep = 0.085f;

        [Header("Day / Night Lighting Rig")]
        [SerializeField] private Light sunDirectionalLight;
        [SerializeField] private Gradient sunColorOverDay;
        [SerializeField] private AnimationCurve sunIntensityOverDay = AnimationCurve.EaseInOut(0f, 0.05f, 0.5f, 1.2f);
        [SerializeField] private Gradient ambientSkyColorOverDay;

        [Header("Day / Night Gameplay Modifiers")]
        [SerializeField] private float nightVisionRadiusMultiplier = 0.48f;
        [SerializeField] private float duskVisionRadiusMultiplier = 0.78f;
        [SerializeField] private float duskShadowLengthMultiplier = 2.6f;
        [SerializeField] private float nightZombieSpeedMultiplier = 1.20f;
        [SerializeField] private float nightZombieSpawnRateMultiplier = 1.35f;

        [Header("Audio & Lightning Hazard References")]
        [SerializeField] private AudioMixer masterAudioMixer;
        [SerializeField] private string audioLowPassParamName = "EnvCueCutoffHz";
        [SerializeField] private LayerMask overheadRoofCheckMask;
        [SerializeField] private LayerMask lightningDamageTargetMask;

        // Runtime State
        private readonly Dictionary<WeatherType, WeatherProfileSO> _profileLookup = new Dictionary<WeatherType, WeatherProfileSO>();
        private readonly Collider[] _lightningHitBuffer = new Collider[24];
        private List<MapWeatherWeight> _activeMapWeatherTable = new List<MapWeatherWeight>();

        private WeatherProfileSO _previousWeatherProfile;
        private WeatherProfileSO _targetWeatherProfile;
        private float _weatherTransitionProgress = 1f;
        private float _weatherStateTimer;
        private float _nextLightningTimer;

        private TimeOfDayPhase _currentPhase = TimeOfDayPhase.Day;
        private EnvironmentGameplaySnapshot _currentSnapshot;
        private readonly List<Transform> _trackedPlayers = new List<Transform>();

        public EnvironmentGameplaySnapshot CurrentSnapshot => _currentSnapshot;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;

            BuildProfileLookup();
            _currentSnapshot = EnvironmentGameplaySnapshot.CreateDefault();

            if (_profileLookup.TryGetValue(WeatherType.Clear, out WeatherProfileSO defaultProfile))
            {
                _previousWeatherProfile = defaultProfile;
                _targetWeatherProfile = defaultProfile;
            }
        }

        private void BuildProfileLookup()
        {
            _profileLookup.Clear();
            for (int i = 0; i < weatherProfiles.Count; i++)
            {
                WeatherProfileSO profile = weatherProfiles[i];
                if (profile != null && !_profileLookup.ContainsKey(profile.WeatherType))
                {
                    _profileLookup.Add(profile.WeatherType, profile);
                }
            }
        }

        /// <summary>
        /// Configures the Environment Director using the loaded MapDefinitionSO's climate & time settings.
        /// </summary>
        public void ConfigureForMap(MapDefinitionSO mapDefinition)
        {
            if (mapDefinition == null) return;

            currentNormalizedTime = mapDefinition.StartingNormalizedTime;
            fullDayCycleDurationSeconds = Mathf.Max(60f, mapDefinition.DayCycleDurationSeconds);

            _activeMapWeatherTable.Clear();
            if (mapDefinition.WeatherProbabilityTable != null)
            {
                _activeMapWeatherTable.AddRange(mapDefinition.WeatherProbabilityTable);
            }

            _currentPhase = EvaluatePhaseFromNormalizedTime(currentNormalizedTime);
            RollNextWeatherFromMapTable(immediate: true);
            RecalculateAndBroadcastSnapshot();
        }

        public void RegisterPlayerTransform(Transform playerTransform)
        {
            if (playerTransform != null && !_trackedPlayers.Contains(playerTransform))
            {
                _trackedPlayers.Add(playerTransform);
            }
        }

        public void UnregisterPlayerTransform(Transform playerTransform)
        {
            _trackedPlayers.Remove(playerTransform);
        }

        /// <summary>
        /// Optional hook for Wave Director to advance Time-of-Day per wave in addition to or instead of real time.
        /// </summary>
        public void AdvanceTimeOnWaveCompleted()
        {
            currentNormalizedTime = Mathf.Repeat(currentNormalizedTime + waveProgressionTimeStep, 1f);
            UpdateDayNightPhaseTransitions();
            RecalculateAndBroadcastSnapshot();
        }

        private void Update()
        {
            float dt = Time.deltaTime;

            UpdateTimeOfDayProgression(dt);
            UpdateWeatherStateMachine(dt);
            UpdateThunderstormHazards(dt);
            RecalculateAndBroadcastSnapshot();
        }

        private void UpdateTimeOfDayProgression(float dt)
        {
            if (advanceTimeContinuously && fullDayCycleDurationSeconds > 0f)
            {
                currentNormalizedTime = Mathf.Repeat(currentNormalizedTime + (dt / fullDayCycleDurationSeconds), 1f);
            }

            UpdateDayNightPhaseTransitions();
            UpdateDirectionalLightingAndShadows(currentNormalizedTime);
        }

        private void UpdateDayNightPhaseTransitions()
        {
            TimeOfDayPhase resolvedPhase = EvaluatePhaseFromNormalizedTime(currentNormalizedTime);
            if (resolvedPhase != _currentPhase)
            {
                _currentPhase = resolvedPhase;
                SurvivalEventBus.PublishTimePhaseChange(_currentPhase);
            }
        }

        private static TimeOfDayPhase EvaluatePhaseFromNormalizedTime(float t)
        {
            // 0.00 - 0.20: Night | 0.20 - 0.30: Dawn | 0.30 - 0.70: Day | 0.70 - 0.82: Dusk | 0.82 - 1.00: Night
            if (t >= 0.20f && t < 0.30f) return TimeOfDayPhase.Dawn;
            if (t >= 0.30f && t < 0.70f) return TimeOfDayPhase.Day;
            if (t >= 0.70f && t < 0.82f) return TimeOfDayPhase.Dusk;
            return TimeOfDayPhase.Night;
        }

        private void UpdateDirectionalLightingAndShadows(float t)
        {
            if (sunDirectionalLight != null)
            {
                // Keep top-down sun pitch between 16 deg (long dramatic Dusk shadows) and 75 deg (Noon)
                float daylightCurve = Mathf.Sin(t * Mathf.PI);
                float pitchAngle = Mathf.Lerp(16f, 75f, daylightCurve);
                float yawAngle = t * 360f;

                sunDirectionalLight.transform.rotation = Quaternion.Euler(pitchAngle, yawAngle, 0f);
                sunDirectionalLight.intensity = sunIntensityOverDay.Evaluate(t);

                if (sunColorOverDay != null)
                {
                    sunDirectionalLight.color = sunColorOverDay.Evaluate(t);
                }
            }

            if (ambientSkyColorOverDay != null)
            {
                RenderSettings.ambientLight = ambientSkyColorOverDay.Evaluate(t);
            }
        }

        private void UpdateWeatherStateMachine(float dt)
        {
            if (_weatherTransitionProgress < 1f)
            {
                _weatherTransitionProgress = Mathf.MoveTowards(
                    _weatherTransitionProgress,
                    1f,
                    dt / Mathf.Max(0.1f, weatherTransitionDuration));
            }

            _weatherStateTimer -= dt;
            if (_weatherStateTimer <= 0f)
            {
                RollNextWeatherFromMapTable(immediate: false);
            }
        }

        /// <summary>
        /// Forces a transition to a specific WeatherType (useful for scripted boss waves or testing).
        /// </summary>
        public void TransitionToWeather(WeatherType nextWeather, float durationSeconds = 90f, bool immediate = false)
        {
            if (!_profileLookup.TryGetValue(nextWeather, out WeatherProfileSO nextProfile))
                return;

            WeatherType prevType = _targetWeatherProfile != null ? _targetWeatherProfile.WeatherType : WeatherType.Clear;
            _previousWeatherProfile = _targetWeatherProfile != null ? _targetWeatherProfile : nextProfile;
            _targetWeatherProfile = nextProfile;
            _weatherTransitionProgress = immediate ? 1f : 0f;
            _weatherStateTimer = Mathf.Max(15f, durationSeconds);

            if (nextProfile.EnableLightningStrikes)
            {
                _nextLightningTimer = UnityEngine.Random.Range(
                    nextProfile.LightningIntervalSeconds.x,
                    nextProfile.LightningIntervalSeconds.y);
            }

            if (prevType != nextWeather)
            {
                SurvivalEventBus.PublishWeatherChange(prevType, nextWeather);
            }
        }

        private void RollNextWeatherFromMapTable(bool immediate)
        {
            if (_activeMapWeatherTable == null || _activeMapWeatherTable.Count == 0)
            {
                TransitionToWeather(WeatherType.Clear, 120f, immediate);
                return;
            }

            float totalWeight = 0f;
            for (int i = 0; i < _activeMapWeatherTable.Count; i++)
            {
                totalWeight += Mathf.Max(0f, _activeMapWeatherTable[i].SelectionWeight);
            }

            if (totalWeight <= 0.001f)
            {
                TransitionToWeather(WeatherType.Clear, 120f, immediate);
                return;
            }

            float roll = UnityEngine.Random.Range(0f, totalWeight);
            float cumulative = 0f;

            for (int i = 0; i < _activeMapWeatherTable.Count; i++)
            {
                MapWeatherWeight entry = _activeMapWeatherTable[i];
                cumulative += Mathf.Max(0f, entry.SelectionWeight);
                if (roll <= cumulative)
                {
                    float duration = UnityEngine.Random.Range(
                        Mathf.Max(20f, entry.DurationSecondsRange.x),
                        Mathf.Max(30f, entry.DurationSecondsRange.y));
                    TransitionToWeather(entry.Weather, duration, immediate);
                    return;
                }
            }
        }

        /// <summary>
        /// Evaluates Thunderstorm lightning hazards in open outdoor areas.
        /// Uses an upward Physics.Raycast to verify the strike point is not underneath a roof/subway tunnel.
        /// </summary>
        private void UpdateThunderstormHazards(float dt)
        {
            if (_targetWeatherProfile == null || !_targetWeatherProfile.EnableLightningStrikes || _weatherTransitionProgress < 0.5f)
                return;

            _nextLightningTimer -= dt;
            if (_nextLightningTimer <= 0f)
            {
                _nextLightningTimer = UnityEngine.Random.Range(
                    _targetWeatherProfile.LightningIntervalSeconds.x,
                    _targetWeatherProfile.LightningIntervalSeconds.y);

                if (TryFindOpenSkyLightningTarget(out Vector3 strikePos))
                {
                    StartCoroutine(ExecuteLightningStrikeSequence(strikePos, _targetWeatherProfile));
                }
            }
        }

        private bool TryFindOpenSkyLightningTarget(out Vector3 validStrikePoint)
        {
            validStrikePoint = Vector3.zero;
            Vector3 searchOrigin = transform.position;

            if (_trackedPlayers.Count > 0)
            {
                Transform randomPlayer = _trackedPlayers[UnityEngine.Random.Range(0, _trackedPlayers.Count)];
                if (randomPlayer != null)
                {
                    searchOrigin = randomPlayer.position;
                }
            }

            for (int attempt = 0; attempt < 6; attempt++)
            {
                Vector2 offset2D = UnityEngine.Random.insideUnitCircle * 18f;
                Vector3 candidate = searchOrigin + new Vector3(offset2D.x, 0.5f, offset2D.y);

                // Verify open sky above candidate point (no roof / tunnel ceiling blocking lightning)
                if (!Physics.Raycast(candidate, Vector3.up, 60f, overheadRoofCheckMask, QueryTriggerInteraction.Ignore))
                {
                    validStrikePoint = new Vector3(candidate.x, searchOrigin.y, candidate.z);
                    return true;
                }
            }
            return false;
        }

        private IEnumerator ExecuteLightningStrikeSequence(Vector3 impactPoint, WeatherProfileSO profile)
        {
            // Phase 1: Telegraph ground ionization warning circle for players to dodge
            SurvivalEventBus.PublishLightningWarning(impactPoint, profile.LightningBlastRadius);
            yield return new WaitForSeconds(profile.LightningTelegraphSeconds);

            // Phase 2: Detonate lightning bolt and apply AoE Electrical Damage
            SurvivalEventBus.PublishLightningImpact(impactPoint, profile.LightningBlastRadius);

            int hitCount = Physics.OverlapSphereNonAlloc(
                impactPoint,
                profile.LightningBlastRadius,
                _lightningHitBuffer,
                lightningDamageTargetMask,
                QueryTriggerInteraction.Ignore);

            for (int i = 0; i < hitCount; i++)
            {
                Collider col = _lightningHitBuffer[i];
                if (col == null) continue;

                IDamageable damageable = col.GetComponentInParent<IDamageable>();
                if (damageable == null || !damageable.IsAlive) continue;

                bool isZombie = col.GetComponentInParent<IZombieAgent>() != null;
                float damageAmount = isZombie ? profile.LightningZombieDamage : profile.LightningPlayerDamage;

                damageable.ApplyDamage(new DamagePayload
                {
                    Amount = damageAmount,
                    Type = DamageType.Electrical,
                    HitPoint = impactPoint,
                    ImpulseForce = (col.transform.position - impactPoint).normalized * 10f + Vector3.up * 3f,
                    Instigator = gameObject
                });
            }
        }

        /// <summary>
        /// Blends previous & target WeatherProfileSO values with current Day/Night modifiers,
        /// updates RenderSettings & AudioMixer, and publishes the unified EnvironmentGameplaySnapshot.
        /// </summary>
        private void RecalculateAndBroadcastSnapshot()
        {
            if (_targetWeatherProfile == null) return;

            WeatherProfileSO from = _previousWeatherProfile != null ? _previousWeatherProfile : _targetWeatherProfile;
            WeatherProfileSO to = _targetWeatherProfile;
            float blend = Mathf.SmoothStep(0f, 1f, _weatherTransitionProgress);

            // 1. Blend Weather Modifiers
            float surfaceFriction = Mathf.Lerp(from.SurfaceFrictionMultiplier, to.SurfaceFrictionMultiplier, blend);
            float playerMoveSpeed = Mathf.Lerp(from.PlayerMoveSpeedMultiplier, to.PlayerMoveSpeedMultiplier, blend);
            float vehicleSlip = Mathf.Lerp(from.VehicleDriftSlipMultiplier, to.VehicleDriftSlipMultiplier, blend);
            float weatherZombieSpeed = Mathf.Lerp(from.ZombieMoveSpeedMultiplier, to.ZombieMoveSpeedMultiplier, blend);
            float baseVisionRadius = Mathf.Lerp(from.BaseTopDownVisionRadius, to.BaseTopDownVisionRadius, blend);
            float minSpawnDist = Mathf.Lerp(from.MinZombieSpawnDistance, to.MinZombieSpawnDistance, blend);
            float overlayIntensity = Mathf.Lerp(from.ScreenOverlayIntensity, to.ScreenOverlayIntensity, blend);
            float audioLowPass = Mathf.Lerp(from.AudioLowPassCutoffHz, to.AudioLowPassCutoffHz, blend);

            // 2. Layer Time-of-Day Modifiers (Day, Dusk, Night, Dawn)
            float timeVisionMultiplier = 1f;
            float shadowLengthMult = 1f;
            float timeZombieSpeedMult = 1f;
            float timeSpawnRateMult = 1f;
            bool isNight = _currentPhase == TimeOfDayPhase.Night;

            switch (_currentPhase)
            {
                case TimeOfDayPhase.Dusk:
                case TimeOfDayPhase.Dawn:
                    timeVisionMultiplier = duskVisionRadiusMultiplier;
                    shadowLengthMult = duskShadowLengthMultiplier;
                    timeZombieSpeedMult = 1.08f;
                    timeSpawnRateMult = 1.15f;
                    break;
                case TimeOfDayPhase.Night:
                    timeVisionMultiplier = nightVisionRadiusMultiplier;
                    shadowLengthMult = 1.5f;
                    timeZombieSpeedMult = nightZombieSpeedMultiplier;
                    timeSpawnRateMult = nightZombieSpawnRateMultiplier;
                    break;
            }

            // 3. Apply Fog & AudioMixer
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = Color.Lerp(from.FogColor, to.FogColor, blend);
            RenderSettings.fogDensity = Mathf.Lerp(from.ExponentialFogDensity, to.ExponentialFogDensity, blend);

            if (masterAudioMixer != null && !string.IsNullOrEmpty(audioLowPassParamName))
            {
                masterAudioMixer.SetFloat(audioLowPassParamName, audioLowPass);
            }

            // 4. Construct & Broadcast Snapshot
            _currentSnapshot = new EnvironmentGameplaySnapshot
            {
                ActiveWeather = to.WeatherType,
                ActiveTimePhase = _currentPhase,
                NormalizedTimeOfDay = currentNormalizedTime,
                WeatherTransitionBlend = blend,
                SurfaceFrictionMultiplier = surfaceFriction,
                PlayerMoveSpeedMultiplier = playerMoveSpeed,
                VehicleDriftSlipMultiplier = vehicleSlip,
                TopDownVisionRadius = baseVisionRadius * timeVisionMultiplier,
                ShadowLengthMultiplier = shadowLengthMult,
                ScreenOverlayIntensity = overlayIntensity,
                RequirePlayerFlashlights = isNight || to.ForcePlayerFlashlights,
                ZombieMoveSpeedMultiplier = weatherZombieSpeed * timeZombieSpeedMult,
                ZombieSpawnRateMultiplier = timeSpawnRateMult,
                MinSpawnDistanceFromPlayer = minSpawnDist,
                AllowNightVariantZombies = isNight,
                AudioCueLowPassCutoffHz = audioLowPass,
                EmitSurfaceTracks = to.LeaveFootprintAndTireTracks && blend >= 0.35f
            };

            SurvivalEventBus.PublishEnvironmentSnapshot(_currentSnapshot);
        }
    }
}
