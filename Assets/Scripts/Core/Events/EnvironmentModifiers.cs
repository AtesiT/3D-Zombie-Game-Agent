using System;
using UnityEngine;

namespace ZombieSurvival.Core
{
    /// <summary>
    /// Enumeration of all supported dynamic weather states in the survival sandbox.
    /// </summary>
    public enum WeatherType
    {
        Clear = 0,
        HeavyRain = 1,
        DenseFog = 2,
        Thunderstorm = 3,
        Snow = 4
    }

    /// <summary>
    /// Discrete phases of the Day/Night cycle used for discrete gameplay triggers
    /// (e.g., Night-only volatile zombie unlocks, flashlight activation).
    /// </summary>
    public enum TimeOfDayPhase
    {
        Dawn = 0,
        Day = 1,
        Dusk = 2,
        Night = 3
    }

    /// <summary>
    /// Immutable, cache-friendly snapshot of all combined environmental gameplay modifiers
    /// (Weather + Time of Day + localized surface zones).
    /// Broadcast via EnvironmentEvents whenever the environment state updates so physics, AI,
    /// camera vision, and audio systems never need hard references to Weather or Time managers.
    /// </summary>
    [Serializable]
    public struct EnvironmentGameplaySnapshot
    {
        [Header("Active States")]
        public WeatherType ActiveWeather;
        public TimeOfDayPhase ActiveTimePhase;
        [Range(0f, 1f)] public float NormalizedTimeOfDay; // 0.0 = Midnight, 0.5 = Noon
        public float WeatherTransitionBlend;

        [Header("Physics & Movement Modifiers")]
        public float SurfaceFrictionMultiplier;       // 1.0 Clear, ~0.55 HeavyRain, ~0.65 Snow
        public float PlayerMoveSpeedMultiplier;       // 1.0 Clear, ~0.82 Snow
        public float VehicleDriftSlipMultiplier;      // >1.0 increases lateral slide in rain/snow

        [Header("Vision & Line-of-Sight Modifiers")]
        public float TopDownVisionRadius;             // Base ~38m, DenseFog ~14m, Night ~18m
        public float ShadowLengthMultiplier;          // peaks at Dusk/Dawn (e.g., 2.8x)
        public float ScreenOverlayIntensity;          // Rain drops / frost / fog vignette [0..1]
        public bool RequirePlayerFlashlights;         // True at Night or DenseFog

        [Header("AI & Wave Director Modifiers")]
        public float ZombieMoveSpeedMultiplier;       // Reduced in Snow (0.85x), boosted at Night (1.2x)
        public float ZombieSpawnRateMultiplier;       // Boosted at Night (1.35x)
        public float MinSpawnDistanceFromPlayer;      // Base 34m; shrinks to 13m in DenseFog
        public bool AllowNightVariantZombies;         // Unlocks Night Stalkers / Volatiles

        [Header("Audio & Surface Persistence")]
        public float AudioCueLowPassCutoffHz;         // 22000Hz Clear -> 1600Hz HeavyRain/Thunderstorm
        public bool EmitSurfaceTracks;                // True during Snow or in Mud zones

        public static EnvironmentGameplaySnapshot CreateDefault()
        {
            return new EnvironmentGameplaySnapshot
            {
                ActiveWeather = WeatherType.Clear,
                ActiveTimePhase = TimeOfDayPhase.Day,
                NormalizedTimeOfDay = 0.5f,
                WeatherTransitionBlend = 1f,
                SurfaceFrictionMultiplier = 1f,
                PlayerMoveSpeedMultiplier = 1f,
                VehicleDriftSlipMultiplier = 1f,
                TopDownVisionRadius = 38f,
                ShadowLengthMultiplier = 1f,
                ScreenOverlayIntensity = 0f,
                RequirePlayerFlashlights = false,
                ZombieMoveSpeedMultiplier = 1f,
                ZombieSpawnRateMultiplier = 1f,
                MinSpawnDistanceFromPlayer = 34f,
                AllowNightVariantZombies = false,
                AudioCueLowPassCutoffHz = 22000f,
                EmitSurfaceTracks = false
            };
        }
    }

    /// <summary>
    /// Contract for any damageable actor (Player, Zombie, Bus Armor, Destructible Environment).
    /// </summary>
    public interface IDamageable
    {
        bool IsAlive { get; }
        void ApplyDamage(DamagePayload payload);
    }

    [Serializable]
    public struct DamagePayload
    {
        public float Amount;
        public DamageType Type;
        public Vector3 HitPoint;
        public Vector3 ImpulseForce;
        public GameObject Instigator;
    }

    public enum DamageType
    {
        Ballistic,
        Explosive,
        VehicleCrush,
        Electrical,
        EnvironmentalTrap
    }

    /// <summary>
    /// Contract for zombies capable of dynamic NavMesh interactions, roof-latching on the Transit Bus,
    /// and vertical fire-escape traversal.
    /// </summary>
    public interface IZombieAgent : IDamageable
    {
        Transform Transform { get; }
        float CurrentSpeed { get; }
        bool IsLatchedToVehicle { get; }
        void ApplyExternalKnockback(Vector3 impulse, float stunDuration);
        void LatchOntoMovingVehicle(Transform latchAnchor, Transform roofNavigationRoot);
        void UnlatchFromVehicle(Vector3 throwOffImpulse, bool ragdoll);
        void ApplyEnvironmentModifiers(float speedMultiplier, float sightRadiusMultiplier);
    }

    /// <summary>
    /// Static event bus for zero-coupling communication between Environment, Map, Vehicle, and AI systems.
    /// </summary>
    public static class SurvivalEventBus
    {
        public static event Action<EnvironmentGameplaySnapshot> OnEnvironmentSnapshotUpdated;
        public static event Action<WeatherType, WeatherType> OnWeatherStateChanged;
        public static event Action<TimeOfDayPhase> OnTimePhaseChanged;
        public static event Action<Vector3, float> OnLightningStrikeWarning;
        public static event Action<Vector3, float> OnLightningStrikeImpact;

        public static void PublishEnvironmentSnapshot(EnvironmentGameplaySnapshot snapshot)
            => OnEnvironmentSnapshotUpdated?.Invoke(snapshot);

        public static void PublishWeatherChange(WeatherType previous, WeatherType next)
            => OnWeatherStateChanged?.Invoke(previous, next);

        public static void PublishTimePhaseChange(TimeOfDayPhase phase)
            => OnTimePhaseChanged?.Invoke(phase);

        public static void PublishLightningWarning(Vector3 position, float radius)
            => OnLightningStrikeWarning?.Invoke(position, radius);

        public static void PublishLightningImpact(Vector3 position, float radius)
            => OnLightningStrikeImpact?.Invoke(position, radius);
    }
}
