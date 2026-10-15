using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using ZombieSurvival.Core;

namespace ZombieSurvival.Systems.Vehicles
{
    /// <summary>
    /// Production-ready Top-Down Armored Bus Controller ("Terminal Transit").
    /// Implements:
    /// 1. Anisotropic Top-Down Drift & Arcade-Tactical Vehicle Physics (modulated by Weather Surface Friction).
    /// 2. Velocity-Gated Hybrid NavMesh Obstacle Carving (prevents CPU NavMesh re-bake thrashing at high speed).
    /// 3. Speed-Proportional Zombie Crushing, Momentum Drag, and Low-Speed Shove physics.
    /// 4. Dynamic Zombie Roof-Latching & High-G Drift Throw-Off mechanics.
    /// 5. Fuel / Charge management with Emergency Reboot Cooldown.
    /// 6. Second-Player Roof-Mounted 360-degree Heavy Turret with rotation stabilization.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    [RequireComponent(typeof(NavMeshObstacle))]
    public class TopDownBusController : MonoBehaviour, IDamageable
    {
        [Header("Drive & Steering Physics")]
        [SerializeField] private float maxForwardSpeed = 18.5f;
        [SerializeField] private float maxReverseSpeed = 8.0f;
        [SerializeField] private float engineAcceleration = 26.0f;
        [SerializeField] private float brakingDeceleration = 34.0f;
        [SerializeField] private float baseTurnTorque = 135.0f;
        [SerializeField] private Vector3 centerOfMassOffset = new Vector3(0f, -0.75f, 0f);

        [Header("Drift & Anisotropic Grip Settings")]
        [Tooltip("0 = pure ice, 1 = instant lateral velocity cancellation.")]
        [Range(0.05f, 1f)]
        [SerializeField] private float normalLateralGrip = 0.82f;
        [Range(0.05f, 1f)]
        [SerializeField] private float driftingLateralGrip = 0.28f;
        [SerializeField] private float driftTurnRateMultiplier = 1.45f;
        [SerializeField] private float lateralGThrowOffThreshold = 11.5f;

        [Header("Fuel / Battery & Armor Pool")]
        [SerializeField] private float maxFuel = 100f;
        [SerializeField] private float fuelDrainPerSecondDriving = 4.2f;
        [SerializeField] private float fuelDrainPerSecondIdling = 0.5f;
        [SerializeField] private float passiveRechargePerSecondWhenOff = 3.5f;
        [SerializeField] private float depletedRebootCooldown = 8.0f;
        [SerializeField] private float maxArmorHealth = 2500f;

        [Header("Hybrid NavMesh Carving Settings")]
        [Tooltip("Below this speed (m/s), NavMeshObstacle carves holes in the NavMesh. Above it, carving disables to prevent CPU stalls.")]
        [SerializeField] private float navMeshCarveMaxSpeed = 1.75f;
        [SerializeField] private float navMeshCarveMoveThreshold = 0.4f;
        [SerializeField] private float navMeshTimeToStationary = 0.25f;

        [Header("Zombie Crushing & Momentum Transfer")]
        [SerializeField] private Transform frontPlowOrigin;
        [SerializeField] private Vector3 frontPlowHalfExtents = new Vector3(1.65f, 1.0f, 0.9f);
        [SerializeField] private LayerMask zombieLayerMask;
        [SerializeField] private float minLethalCrushSpeed = 6.5f;
        [SerializeField] private float maxCrushDamage = 1200f;
        [SerializeField] private float subLethalShoveImpulse = 14f;
        [Tooltip("Fraction of speed lost per crushed zombie to give heavy tactile feedback.")]
        [Range(0f, 0.15f)]
        [SerializeField] private float momentumLossPerCrush = 0.025f;

        [Header("Zombie Roof Latching & Boarding")]
        [SerializeField] private float maxSpeedForZombieBoarding = 3.5f;
        [SerializeField] private Transform roofNavigationRoot;
        [SerializeField] private Transform[] boardingLatchPoints;
        [SerializeField] private int maxLatchedZombies = 8;

        [Header("Co-Op Seat & Roof Turret Reference")]
        [SerializeField] private BusMountedTurretController roofTurret;
        [SerializeField] private Transform driverExitPoint;
        [SerializeField] private Light[] headlights;

        // Runtime State
        private Rigidbody _rb;
        private NavMeshObstacle _navObstacle;
        private readonly Collider[] _plowHitBuffer = new Collider[32];
        private readonly HashSet<IZombieAgent> _latchedZombies = new HashSet<IZombieAgent>();
        private readonly Dictionary<int, float> _recentHitCooldowns = new Dictionary<int, float>();

        private float _throttleInput;
        private float _steerInput;
        private bool _isHandbrakeDrifting;
        private bool _hasDriverSeated;

        private float _currentFuel;
        private float _currentArmorHealth;
        private float _rebootCooldownTimer;
        private bool _isEngineStalled;

        // Cached Weather & Environment Modifiers
        private float _weatherSurfaceFriction = 1f;
        private float _weatherDriftSlipMultiplier = 1f;
        private Vector3 _previousVelocity;

        // Public Telemetry
        public float CurrentSpeed => _rb != null ? _rb.velocity.magnitude : 0f;
        public float SignedForwardSpeed => _rb != null ? Vector3.Dot(_rb.velocity, transform.forward) : 0f;
        public float FuelNormalized => maxFuel > 0f ? _currentFuel / maxFuel : 0f;
        public float ArmorNormalized => maxArmorHealth > 0f ? _currentArmorHealth / maxArmorHealth : 0f;
        public bool IsAlive => _currentArmorHealth > 0f;
        public bool IsDrifting => _isHandbrakeDrifting && CurrentSpeed > 4.0f;
        public int LatchedZombieCount => _latchedZombies.Count;

        public event Action<float> OnFuelChanged;
        public event Action<float> OnArmorChanged;
        public event Action<IZombieAgent, float> OnZombieCrushed;
        public event Action OnEngineStalled;
        public event Action OnEngineRebooted;

        private void Awake()
        {
            _rb = GetComponent<Rigidbody>();
            _navObstacle = GetComponent<NavMeshObstacle>();

            _rb.centerOfMass = centerOfMassOffset;
            _rb.interpolation = RigidbodyInterpolation.Interpolate;
            _rb.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
            // Constrain roll and pitch so top-down impacts never flip the bus upside down
            _rb.constraints = RigidbodyConstraints.FreezeRotationX | RigidbodyConstraints.FreezeRotationZ;

            _currentFuel = maxFuel;
            _currentArmorHealth = maxArmorHealth;

            ConfigureNavMeshObstacle();
        }

        private void OnEnable()
        {
            SurvivalEventBus.OnEnvironmentSnapshotUpdated += HandleEnvironmentUpdated;
        }

        private void OnDisable()
        {
            SurvivalEventBus.OnEnvironmentSnapshotUpdated -= HandleEnvironmentUpdated;
        }

        private void ConfigureNavMeshObstacle()
        {
            if (_navObstacle == null) return;
            _navObstacle.shape = NavMeshObstacleShape.Box;
            _navObstacle.carving = true;
            _navObstacle.carveOnlyStationary = false;
            _navObstacle.carvingMoveThreshold = navMeshCarveMoveThreshold;
            _navObstacle.carvingTimeToStationary = navMeshTimeToStationary;
        }

        private void HandleEnvironmentUpdated(EnvironmentGameplaySnapshot snapshot)
        {
            _weatherSurfaceFriction = Mathf.Clamp(snapshot.SurfaceFrictionMultiplier, 0.2f, 1.5f);
            _weatherDriftSlipMultiplier = Mathf.Clamp(snapshot.VehicleDriftSlipMultiplier, 0.5f, 2.5f);

            // Automatically toggle bus headlights during Night or Dense Fog
            if (headlights != null)
            {
                for (int i = 0; i < headlights.Length; i++)
                {
                    if (headlights[i] != null)
                    {
                        headlights[i].enabled = snapshot.RequirePlayerFlashlights;
                    }
                }
            }
        }

        /// <summary>
        /// Feeds Player 1 (Driver) control inputs into the Bus simulation.
        /// </summary>
        public void SetDriverInputs(float throttle, float steering, bool handbrakeDrift)
        {
            _throttleInput = Mathf.Clamp(throttle, -1f, 1f);
            _steerInput = Mathf.Clamp(steering, -1f, 1f);
            _isHandbrakeDrifting = handbrakeDrift;
        }

        public void SetDriverSeated(bool seated)
        {
            _hasDriverSeated = seated;
            if (!seated)
            {
                _throttleInput = 0f;
                _steerInput = 0f;
                _isHandbrakeDrifting = false;
            }
        }

        private void Update()
        {
            UpdateFuelAndEngineState(Time.deltaTime);
            UpdateHybridNavMeshCarvingState();
            CleanupHitCooldownCache();
        }

        private void FixedUpdate()
        {
            float dt = Time.fixedDeltaTime;
            ExecuteTopDownVehiclePhysics(dt);
            EvaluateFrontPlowZombieCrushing();
            EvaluateHighGThrowOffForLatchedZombies(dt);
            _previousVelocity = _rb.velocity;
        }

        private void UpdateFuelAndEngineState(float dt)
        {
            if (_isEngineStalled)
            {
                _rebootCooldownTimer -= dt;
                _currentFuel = Mathf.Min(maxFuel, _currentFuel + passiveRechargePerSecondWhenOff * dt);
                OnFuelChanged?.Invoke(FuelNormalized);

                if (_rebootCooldownTimer <= 0f && _currentFuel >= maxFuel * 0.25f)
                {
                    _isEngineStalled = false;
                    OnEngineRebooted?.Invoke();
                }
                return;
            }

            if (_hasDriverSeated && IsAlive)
            {
                bool isApplyingThrottle = Mathf.Abs(_throttleInput) > 0.05f;
                float drainRate = isApplyingThrottle ? fuelDrainPerSecondDriving : fuelDrainPerSecondIdling;
                _currentFuel = Mathf.Max(0f, _currentFuel - drainRate * dt);
                OnFuelChanged?.Invoke(FuelNormalized);

                if (_currentFuel <= 0f)
                {
                    TriggerEngineStall();
                }
            }
            else
            {
                // Passive capacitor/solar trickle charge while driver is dismounted
                if (_currentFuel < maxFuel)
                {
                    _currentFuel = Mathf.Min(maxFuel, _currentFuel + passiveRechargePerSecondWhenOff * dt);
                    OnFuelChanged?.Invoke(FuelNormalized);
                }
            }
        }

        private void TriggerEngineStall()
        {
            _isEngineStalled = true;
            _rebootCooldownTimer = depletedRebootCooldown;
            _throttleInput = 0f;
            OnEngineStalled?.Invoke();
        }

        /// <summary>
        /// Refuels the bus immediately (e.g., when a player brings a Gas Canister / Power Cell).
        /// </summary>
        public void AddFuel(float amount)
        {
            _currentFuel = Mathf.Clamp(_currentFuel + amount, 0f, maxFuel);
            OnFuelChanged?.Invoke(FuelNormalized);
        }

        /// <summary>
        /// Critical NavMesh Optimization:
        /// Enables voxel NavMesh carving ONLY when the bus is parked or creeping slowly (< 1.75 m/s)
        /// so zombies pathfind cleanly around the bus as a barricade.
        /// Disables voxel carving at high speeds so the NavMesh worker thread isn't re-baking tiles every frame.
        /// </summary>
        private void UpdateHybridNavMeshCarvingState()
        {
            if (_navObstacle == null) return;

            bool shouldCarve = CurrentSpeed <= navMeshCarveMaxSpeed;
            if (_navObstacle.carving != shouldCarve)
            {
                _navObstacle.carving = shouldCarve;
            }
        }

        private void ExecuteTopDownVehiclePhysics(float dt)
        {
            Vector3 currentVel = _rb.velocity;
            Vector3 forwardDir = transform.forward;
            Vector3 rightDir = transform.right;

            float forwardSpeed = Vector3.Dot(currentVel, forwardDir);
            float lateralSpeed = Vector3.Dot(currentVel, rightDir);

            bool canDrive = _hasDriverSeated && !_isEngineStalled && IsAlive && _currentFuel > 0f;

            // 1. Longitudinal Force (Acceleration / Braking / Reverse)
            if (canDrive && Mathf.Abs(_throttleInput) > 0.01f)
            {
                bool isBraking = (forwardSpeed > 0.5f && _throttleInput < 0f) ||
                                 (forwardSpeed < -0.5f && _throttleInput > 0f);

                if (isBraking)
                {
                    float brakeForce = _throttleInput * brakingDeceleration * _weatherSurfaceFriction;
                    _rb.AddForce(forwardDir * brakeForce, ForceMode.Acceleration);
                }
                else
                {
                    float speedCap = _throttleInput > 0f ? maxForwardSpeed : maxReverseSpeed;
                    if (Mathf.Abs(forwardSpeed) < speedCap)
                    {
                        float driveForce = _throttleInput * engineAcceleration * _weatherSurfaceFriction;
                        _rb.AddForce(forwardDir * driveForce, ForceMode.Acceleration);
                    }
                }
            }
            else
            {
                // Natural rolling resistance or handbrake stop
                float rollingDrag = _isHandbrakeDrifting ? brakingDeceleration * 0.65f : 4.5f;
                float newForward = Mathf.MoveTowards(forwardSpeed, 0f, rollingDrag * _weatherSurfaceFriction * dt);
                _rb.AddForce(forwardDir * (newForward - forwardSpeed), ForceMode.VelocityChange);
            }

            // 2. Anisotropic Lateral Friction (Controls Drift Feel & Weather Slipperiness)
            float baseGrip = _isHandbrakeDrifting ? driftingLateralGrip : normalLateralGrip;
            float effectiveGrip = Mathf.Clamp01((baseGrip * _weatherSurfaceFriction) / _weatherDriftSlipMultiplier);

            float cancelledLateralVelocity = -lateralSpeed * effectiveGrip;
            _rb.AddForce(rightDir * cancelledLateralVelocity, ForceMode.VelocityChange);

            // 3. Speed-Proportional Steering Torque
            // Prevents spinning in place when speed is 0; reverses steering direction when backing up
            float steeringSpeedFactor = Mathf.Clamp01(Mathf.Abs(forwardSpeed) / 3.5f);
            if (canDrive && steeringSpeedFactor > 0.05f && Mathf.Abs(_steerInput) > 0.01f)
            {
                float reverseSign = forwardSpeed >= -0.1f ? 1f : -1f;
                float driftBonus = _isHandbrakeDrifting ? driftTurnRateMultiplier : 1f;
                float yawDelta = _steerInput * reverseSign * baseTurnTorque * driftBonus * steeringSpeedFactor * dt;

                Quaternion deltaRot = Quaternion.Euler(0f, yawDelta, 0f);
                _rb.MoveRotation(_rb.rotation * deltaRot);
            }
        }

        /// <summary>
        /// Evaluates kinetic impact along the armored front plow and side hull.
        /// High speed -> Lethal Crush + Momentum Transfer.
        /// Low speed -> Knockback shove to clear path without free infinite kills.
        /// </summary>
        private void EvaluateFrontPlowZombieCrushing()
        {
            float speed = CurrentSpeed;
            if (speed < 1.2f || frontPlowOrigin == null)
                return;

            int hitCount = Physics.OverlapBoxNonAlloc(
                frontPlowOrigin.position,
                frontPlowHalfExtents,
                _plowHitBuffer,
                frontPlowOrigin.rotation,
                zombieLayerMask,
                QueryTriggerInteraction.Ignore);

            for (int i = 0; i < hitCount; i++)
            {
                Collider col = _plowHitBuffer[i];
                if (col == null) continue;

                int instanceId = col.gameObject.GetInstanceID();
                if (_recentHitCooldowns.ContainsKey(instanceId))
                    continue;

                IZombieAgent zombie = col.GetComponentInParent<IZombieAgent>();
                if (zombie == null || !zombie.IsAlive || zombie.IsLatchedToVehicle)
                    continue;

                _recentHitCooldowns[instanceId] = Time.time + 0.35f;

                Vector3 impactDirection = (zombie.Transform.position - transform.position).normalized;
                impactDirection.y = 0.25f;
                impactDirection.Normalize();

                if (speed >= minLethalCrushSpeed)
                {
                    float speedRatio = Mathf.Clamp01(speed / maxForwardSpeed);
                    float crushDamage = Mathf.Lerp(maxCrushDamage * 0.45f, maxCrushDamage, speedRatio);

                    zombie.ApplyDamage(new DamagePayload
                    {
                        Amount = crushDamage,
                        Type = DamageType.VehicleCrush,
                        HitPoint = col.ClosestPoint(frontPlowOrigin.position),
                        ImpulseForce = impactDirection * (speed * 1.6f),
                        Instigator = gameObject
                    });

                    // Apply tactile momentum drag so plowing through a 40-zombie horde slows the bus
                    _rb.velocity *= (1f - momentumLossPerCrush);
                    OnZombieCrushed?.Invoke(zombie, crushDamage);
                }
                else
                {
                    // Sub-lethal bumper shove
                    zombie.ApplyExternalKnockback(impactDirection * subLethalShoveImpulse, stunDuration: 0.9f);
                }
            }
        }

        /// <summary>
        /// Calculates lateral G-force acceleration during sharp drifts or collisions.
        /// If lateral G exceeds threshold, any zombies latched onto the bus roof are flung off!
        /// </summary>
        private void EvaluateHighGThrowOffForLatchedZombies(float dt)
        {
            if (_latchedZombies.Count == 0 || dt <= 0.0001f)
                return;

            Vector3 worldAcceleration = (_rb.velocity - _previousVelocity) / dt;
            float lateralAccel = Mathf.Abs(Vector3.Dot(worldAcceleration, transform.right));

            if (lateralAccel >= lateralGThrowOffThreshold)
            {
                Vector3 flingDirection = -transform.right * Mathf.Sign(Vector3.Dot(worldAcceleration, transform.right)) + Vector3.up * 0.45f;
                FlingAllLatchedZombies(flingDirection.normalized * (lateralAccel * 0.85f));
            }
        }

        /// <summary>
        /// Called by Zombie AI when attempting to board the bus via one of its perimeter latch nodes.
        /// </summary>
        public bool TryLatchZombieOntoBus(IZombieAgent zombie)
        {
            if (zombie == null || !zombie.IsAlive || zombie.IsLatchedToVehicle)
                return false;

            if (CurrentSpeed > maxSpeedForZombieBoarding || _latchedZombies.Count >= maxLatchedZombies)
                return false;

            Transform bestAnchor = FindNearestBoardingLatchPoint(zombie.Transform.position);
            if (bestAnchor == null)
                return false;

            _latchedZombies.Add(zombie);
            zombie.LatchOntoMovingVehicle(bestAnchor, roofNavigationRoot != null ? roofNavigationRoot : transform);
            return true;
        }

        public void UnregisterLatchedZombie(IZombieAgent zombie)
        {
            if (zombie != null)
            {
                _latchedZombies.Remove(zombie);
            }
        }

        private void FlingAllLatchedZombies(Vector3 impulse)
        {
            foreach (IZombieAgent zombie in _latchedZombies)
            {
                if (zombie != null && zombie.IsAlive)
                {
                    zombie.UnlatchFromVehicle(impulse, ragdoll: true);
                }
            }
            _latchedZombies.Clear();
        }

        private Transform FindNearestBoardingLatchPoint(Vector3 worldPos)
        {
            if (boardingLatchPoints == null || boardingLatchPoints.Length == 0)
                return transform;

            Transform closest = boardingLatchPoints[0];
            float bestDistSq = (closest.position - worldPos).sqrMagnitude;

            for (int i = 1; i < boardingLatchPoints.Length; i++)
            {
                if (boardingLatchPoints[i] == null) continue;
                float dSq = (boardingLatchPoints[i].position - worldPos).sqrMagnitude;
                if (dSq < bestDistSq)
                {
                    bestDistSq = dSq;
                    closest = boardingLatchPoints[i];
                }
            }
            return closest;
        }

        private void CleanupHitCooldownCache()
        {
            if (_recentHitCooldowns.Count == 0) return;

            float now = Time.time;
            List<int> expiredKeys = null;
            foreach (var kvp in _recentHitCooldowns)
            {
                if (now >= kvp.Value)
                {
                    expiredKeys ??= new List<int>();
                    expiredKeys.Add(kvp.Key);
                }
            }

            if (expiredKeys != null)
            {
                for (int i = 0; i < expiredKeys.Count; i++)
                {
                    _recentHitCooldowns.Remove(expiredKeys[i]);
                }
            }
        }

        public void ApplyDamage(DamagePayload payload)
        {
            if (!IsAlive) return;

            _currentArmorHealth = Mathf.Max(0f, _currentArmorHealth - payload.Amount);
            OnArmorChanged?.Invoke(ArmorNormalized);

            if (_currentArmorHealth <= 0f)
            {
                TriggerEngineStall();
            }
        }
    }

    /// <summary>
    /// Second-Player Co-Op Roof-Mounted 360° Heavy Turret Controller.
    /// Stabilizes world-space aim against the Bus's yaw rotation so the gunner's aim never jerks
    /// when the driver drifts around corners.
    /// </summary>
    public class BusMountedTurretController : MonoBehaviour
    {
        [Header("Turret Aim & Ballistics")]
        [SerializeField] private Transform turretYawPivot;
        [SerializeField] private Transform muzzleTransform;
        [SerializeField] private float rotationSpeedDegreesPerSec = 540f;
        [SerializeField] private float roundsPerMinute = 650f;
        [SerializeField] private float damagePerShot = 85f;
        [SerializeField] private float maxRange = 42f;
        [SerializeField] private LayerMask hitMask;

        [Header("Thermal Overheat Mechanics")]
        [SerializeField] private float heatGeneratedPerShot = 0.045f;
        [SerializeField] private float passiveCoolingPerSecond = 0.28f;
        [SerializeField] private float overheatedPenaltySeconds = 3.5f;

        private Vector3 _DesiredWorldAimPoint;
        private bool _isTriggerHeld;
        private bool _hasGunnerSeated;
        private float _nextFireTime;
        private float _currentHeatNormalized;
        private bool _isOverheated;
        private float _overheatRecoveryTimer;

        public float HeatNormalized => _currentHeatNormalized;
        public bool IsOverheated => _isOverheated;

        public event Action<Vector3, Vector3> OnTurretFired;
        public event Action<bool> OnOverheatStateChanged;

        public void SetGunnerSeated(bool seated)
        {
            _hasGunnerSeated = seated;
            if (!seated)
            {
                _isTriggerHeld = false;
            }
        }

        public void SetGunnerInputs(Vector3 worldAimTarget, bool fireTriggerHeld)
        {
            _DesiredWorldAimPoint = worldAimTarget;
            _isTriggerHeld = fireTriggerHeld;
        }

        private void Update()
        {
            float dt = Time.deltaTime;
            UpdateThermalCooling(dt);

            if (!_hasGunnerSeated || turretYawPivot == null)
                return;

            RotateTurretTowardWorldTarget(dt);

            if (_isTriggerHeld && !_isOverheated && Time.time >= _nextFireTime)
            {
                FireTurretRound();
            }
        }

        /// <summary>
        /// Tracks a world-space cursor target directly in world space, automatically compensating
        /// for any underlying rotation of the Bus chassis underneath.
        /// </summary>
        private void RotateTurretTowardWorldTarget(float dt)
        {
            Vector3 flatDirection = _DesiredWorldAimPoint - turretYawPivot.position;
            flatDirection.y = 0f;

            if (flatDirection.sqrMagnitude < 0.001f)
                return;

            Quaternion targetWorldRotation = Quaternion.LookRotation(flatDirection.normalized, Vector3.up);
            turretYawPivot.rotation = Quaternion.RotateTowards(
                turretYawPivot.rotation,
                targetWorldRotation,
                rotationSpeedDegreesPerSec * dt);
        }

        private void UpdateThermalCooling(float dt)
        {
            if (_isOverheated)
            {
                _overheatRecoveryTimer -= dt;
                _currentHeatNormalized = Mathf.Clamp01(_overheatRecoveryTimer / overheatedPenaltySeconds);
                if (_overheatRecoveryTimer <= 0f)
                {
                    _isOverheated = false;
                    _currentHeatNormalized = 0f;
                    OnOverheatStateChanged?.Invoke(false);
                }
                return;
            }

            if (!_isTriggerHeld && _currentHeatNormalized > 0f)
            {
                _currentHeatNormalized = Mathf.Max(0f, _currentHeatNormalized - passiveCoolingPerSecond * dt);
            }
        }

        private void FireTurretRound()
        {
            float fireInterval = 60f / Mathf.Max(1f, roundsPerMinute);
            _nextFireTime = Time.time + fireInterval;

            _currentHeatNormalized = Mathf.Clamp01(_currentHeatNormalized + heatGeneratedPerShot);
            if (_currentHeatNormalized >= 1f)
            {
                _isOverheated = true;
                _overheatRecoveryTimer = overheatedPenaltySeconds;
                OnOverheatStateChanged?.Invoke(true);
            }

            Vector3 origin = muzzleTransform != null ? muzzleTransform.position : turretYawPivot.position;
            Vector3 direction = muzzleTransform != null ? muzzleTransform.forward : turretYawPivot.forward;
            Vector3 endPoint = origin + direction * maxRange;

            if (Physics.Raycast(origin, direction, out RaycastHit hit, maxRange, hitMask, QueryTriggerInteraction.Ignore))
            {
                endPoint = hit.point;
                IDamageable damageable = hit.collider.GetComponentInParent<IDamageable>();
                if (damageable != null && damageable.IsAlive)
                {
                    damageable.ApplyDamage(new DamagePayload
                    {
                        Amount = damagePerShot,
                        Type = DamageType.Ballistic,
                        HitPoint = hit.point,
                        ImpulseForce = direction * 12f,
                        Instigator = gameObject
                    });
                }
            }

            OnTurretFired?.Invoke(origin, endPoint);
        }
    }
}
