using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using ZombieSurvival.Core;

namespace ZombieSurvival.Systems.Maps
{
    /// <summary>
    /// Map 2 ("Neon Night Market") Unique Mechanic:
    /// Destructible overhanging Neon Sign that drops when its mounting brackets are shot,
    /// crushing targets directly underneath and creating an Electrified Hazard Zone on the alley floor.
    /// Synergizes with HeavyRain / Thunderstorm weather: rain expands the electrical puddle radius!
    /// </summary>
    public class DestructibleNeonSignHazard : MonoBehaviour, IDamageable
    {
        [Header("Bracket & Drop Settings")]
        [SerializeField] private float bracketMaxHealth = 75f;
        [SerializeField] private Transform signBodyTransform;
        [SerializeField] private Transform groundDropTarget;
        [SerializeField] private float dropSpeed = 22f;
        [SerializeField] private float impactCrushRadius = 2.6f;
        [SerializeField] private float impactCrushDamage = 500f;

        [Header("Electrical Hazard Pool Settings")]
        [SerializeField] private float baseElectricalRadius = 3.5f;
        [SerializeField] private float rainRadiusMultiplier = 1.65f;
        [SerializeField] private float hazardActiveDuration = 14f;
        [SerializeField] private float shockTickInterval = 0.5f;
        [SerializeField] private float shockDamagePerTick = 38f;
        [SerializeField] private LayerMask targetLayerMask;

        private float _currentHealth;
        private bool _hasTriggered;
        private bool _isRaining;
        private readonly Collider[] _hitBuffer = new Collider[24];

        public bool IsAlive => !_hasTriggered && _currentHealth > 0f;

        private void Awake()
        {
            _currentHealth = bracketMaxHealth;
        }

        private void OnEnable()
        {
            SurvivalEventBus.OnEnvironmentSnapshotUpdated += HandleEnvironmentUpdated;
        }

        private void OnDisable()
        {
            SurvivalEventBus.OnEnvironmentSnapshotUpdated -= HandleEnvironmentUpdated;
        }

        private void HandleEnvironmentUpdated(EnvironmentGameplaySnapshot snapshot)
        {
            _isRaining = snapshot.ActiveWeather == WeatherType.HeavyRain ||
                         snapshot.ActiveWeather == WeatherType.Thunderstorm;
        }

        public void ApplyDamage(DamagePayload payload)
        {
            if (!IsAlive) return;

            _currentHealth -= payload.Amount;
            if (_currentHealth <= 0f)
            {
                _hasTriggered = true;
                StartCoroutine(ExecuteSignDropAndElectrifyRoutine());
            }
        }

        private IEnumerator ExecuteSignDropAndElectrifyRoutine()
        {
            Vector3 impactPoint = groundDropTarget != null ? groundDropTarget.position : transform.position;

            if (signBodyTransform != null)
            {
                while ((signBodyTransform.position - impactPoint).sqrMagnitude > 0.04f)
                {
                    signBodyTransform.position = Vector3.MoveTowards(
                        signBodyTransform.position,
                        impactPoint,
                        dropSpeed * Time.deltaTime);
                    yield return null;
                }
            }

            // 1. Apply Initial Impact Crush Damage
            ApplyRadialDamage(impactPoint, impactCrushRadius, impactCrushDamage, DamageType.EnvironmentalTrap);

            // 2. Sustain Electrified Alley Hazard Zone (Expanded if Raining!)
            float elapsed = 0f;
            while (elapsed < hazardActiveDuration)
            {
                float effectiveRadius = _isRaining
                    ? baseElectricalRadius * rainRadiusMultiplier
                    : baseElectricalRadius;

                ApplyRadialDamage(impactPoint, effectiveRadius, shockDamagePerTick, DamageType.Electrical);
                yield return new WaitForSeconds(shockTickInterval);
                elapsed += shockTickInterval;
            }
        }

        private void ApplyRadialDamage(Vector3 center, float radius, float damage, DamageType damageType)
        {
            int count = Physics.OverlapSphereNonAlloc(center, radius, _hitBuffer, targetLayerMask, QueryTriggerInteraction.Ignore);
            for (int i = 0; i < count; i++)
            {
                Collider col = _hitBuffer[i];
                if (col == null) continue;

                IDamageable target = col.GetComponentInParent<IDamageable>();
                if (target != null && target.IsAlive)
                {
                    target.ApplyDamage(new DamagePayload
                    {
                        Amount = damage,
                        Type = damageType,
                        HitPoint = center,
                        ImpulseForce = Vector3.up * 2f,
                        Instigator = gameObject
                    });
                }
            }
        }
    }

    /// <summary>
    /// Map 3 ("Blackwood Logging Camp") Unique Mechanic:
    /// Destructible Timber Support that fells a massive tree along a directional sweep corridor,
    /// crushing all zombies in its path and activating a temporary NavMeshObstacle log barrier.
    /// </summary>
    public class DestructibleFallingTree : MonoBehaviour, IDamageable
    {
        [SerializeField] private float supportHealth = 120f;
        [SerializeField] private Transform treeTrunkPivot;
        [SerializeField] private float fallDurationSeconds = 1.15f;
        [SerializeField] private Vector3 crushCorridorHalfExtents = new Vector3(1.2f, 1.5f, 7.0f);
        [SerializeField] private float crushDamage = 1200f;
        [SerializeField] private NavMeshObstacle fallenLogNavObstacle;
        [SerializeField] private LayerMask zombieAndPlayerMask;

        private float _currentHealth;
        private bool _hasFallen;
        private readonly Collider[] _crushBuffer = new Collider[32];

        public bool IsAlive => !_hasFallen && _currentHealth > 0f;

        private void Awake()
        {
            _currentHealth = supportHealth;
            if (fallenLogNavObstacle != null)
            {
                fallenLogNavObstacle.enabled = false;
            }
        }

        public void ApplyDamage(DamagePayload payload)
        {
            if (!IsAlive) return;

            _currentHealth -= payload.Amount;
            if (_currentHealth <= 0f)
            {
                _hasFallen = true;
                StartCoroutine(FallAndCarveNavMeshRoutine());
            }
        }

        private IEnumerator FallAndCarveNavMeshRoutine()
        {
            Quaternion startRot = treeTrunkPivot != null ? treeTrunkPivot.rotation : transform.rotation;
            Quaternion endRot = startRot * Quaternion.Euler(88f, 0f, 0f);

            float t = 0f;
            while (t < 1f)
            {
                t += Time.deltaTime / Mathf.Max(0.1f, fallDurationSeconds);
                // Ease-in quadratic curve to mimic gravity accelerating a falling tree
                float eased = t * t;
                if (treeTrunkPivot != null)
                {
                    treeTrunkPivot.rotation = Quaternion.Slerp(startRot, endRot, eased);
                }
                yield return null;
            }

            // Crush everything along the fallen trunk corridor
            Vector3 boxCenter = transform.position + transform.forward * crushCorridorHalfExtents.z;
            int hits = Physics.OverlapBoxNonAlloc(
                boxCenter,
                crushCorridorHalfExtents,
                _crushBuffer,
                transform.rotation,
                zombieAndPlayerMask,
                QueryTriggerInteraction.Ignore);

            for (int i = 0; i < hits; i++)
            {
                Collider col = _crushBuffer[i];
                if (col == null) continue;

                IDamageable target = col.GetComponentInParent<IDamageable>();
                if (target != null && target.IsAlive)
                {
                    target.ApplyDamage(new DamagePayload
                    {
                        Amount = crushDamage,
                        Type = DamageType.EnvironmentalTrap,
                        HitPoint = col.transform.position,
                        ImpulseForce = transform.forward * 15f,
                        Instigator = gameObject
                    });
                }
            }

            // Enable NavMesh carving so the fallen tree trunk acts as a tactical choke barrier
            if (fallenLogNavObstacle != null)
            {
                fallenLogNavObstacle.enabled = true;
                fallenLogNavObstacle.carving = true;
            }
        }
    }

    /// <summary>
    /// Map 3 ("Blackwood Logging Camp") Zipline Escape System:
    /// Allows players cornered on elevated sawmill platforms to rapidly traverse above zombie hordes.
    /// </summary>
    public class TacticalEscapeZipline : MonoBehaviour
    {
        [SerializeField] private Transform startAnchor;
        [SerializeField] private Transform endAnchor;
        [SerializeField] private float zipSpeedMetersPerSec = 18.5f;
        [SerializeField] private float cooldownSeconds = 15f;

        private float _readyTime;
        public bool IsAvailable => Time.time >= _readyTime;

        public bool TryStartZiplineTraversal(Transform playerTransform, MonoBehaviour coroutineHost)
        {
            if (!IsAvailable || playerTransform == null || coroutineHost == null || startAnchor == null || endAnchor == null)
                return false;

            _readyTime = Time.time + cooldownSeconds;
            coroutineHost.StartCoroutine(TraverseZiplineRoutine(playerTransform));
            return true;
        }

        private IEnumerator TraverseZiplineRoutine(Transform rider)
        {
            Collider riderCol = rider.GetComponent<Collider>();
            if (riderCol != null) riderCol.enabled = false;

            rider.position = startAnchor.position;
            while ((rider.position - endAnchor.position).sqrMagnitude > 0.05f)
            {
                rider.position = Vector3.MoveTowards(
                    rider.position,
                    endAnchor.position,
                    zipSpeedMetersPerSec * Time.deltaTime);
                yield return null;
            }

            if (riderCol != null) riderCol.enabled = true;
        }
    }

    /// <summary>
    /// Map 3 ("Blackwood Logging Camp") Localized Mud Hazard Patch:
    /// Applies localized movement speed reduction to both Players and Zombies wading through deep mud.
    /// </summary>
    [RequireComponent(typeof(Collider))]
    public class MudSlowdownZone : MonoBehaviour
    {
        [Range(0.25f, 1f)]
        [SerializeField] private float zombieMudSpeedMultiplier = 0.62f;

        private readonly HashSet<IZombieAgent> _affectedZombies = new HashSet<IZombieAgent>();

        private void OnTriggerEnter(Collider other)
        {
            IZombieAgent zombie = other.GetComponentInParent<IZombieAgent>();
            if (zombie != null && _affectedZombies.Add(zombie))
            {
                zombie.ApplyEnvironmentModifiers(zombieMudSpeedMultiplier, 1f);
            }
        }

        private void OnTriggerExit(Collider other)
        {
            IZombieAgent zombie = other.GetComponentInParent<IZombieAgent>();
            if (zombie != null && _affectedZombies.Remove(zombie))
            {
                zombie.ApplyEnvironmentModifiers(1f, 1f);
            }
        }
    }
}
