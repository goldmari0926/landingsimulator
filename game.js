/* =====================================================================
   우주선 착륙 게임
   Stage 1: 동역학 | Stage 2: +유체역학(바람/항력) | Stage 3: +열역학(엔진 발열/냉각)
   + 우주선 업그레이드 + Credits + 스테이지 선택/해금 + localStorage 저장
   =====================================================================
   이 파일은 아래 순서로 구성되어 있다.

     1. CONFIG               : 물리 상수 & 게임 설정값
     2. HEAT                  : Stage 3 열역학 상수 (온도 기준값 등)
     3. shipStats / upgradeData / stages / saveData / gameState
     4. upgradeSystem          : 업그레이드 -> 실제 물리값 변환
     5. Vector2                : 2차원 벡터 연산
     6. Planet                  : 행성(중력, 지면)
     7. LandingPad               : 착륙 패드
     8. WindSystem                : (Stage 2+) 부드럽게 변하는 바람
     9. thermodynamicsSystem       : (Stage 3) 엔진 효율/온도 계산 순수 함수들
    10. 물리 힘 계산 함수들          : applyGravity / applyThrust / applyAerodynamicForces
    11. Spaceship                   : 우주선의 물리 상태 & 운동 계산 (그리기 없음)
    12. InputHandler                 : 키보드 입력
    13. Renderer                      : Canvas 그리기 (물리 계산 없음)
    14. Game                           : 착륙 게임 메인 루프 (스테이지별 설정 적용)
    15. upgradeUI / stageSelectUI       : 업그레이드 & 미션 선택 화면 렌더링
    16. 화면 전환 & 부트스트랩

   * 단위계: 1px ≈ 1m 로 취급하는 단순화된 단위계.
   * Stage 1(중력만) / Stage 2(중력+바람+항력)의 물리는 이전과 완전히 동일하게 유지된다.
     Stage 3에서만 "열역학" 계산이 추가로 실행된다 (currentStage.thermodynamics === true 일 때만).
   * Stage 4~5를 추가할 때는 STAGES에 스테이지를 하나 더 넣고, 필요하면
     힘 계산 함수(computeXxxForce)나 열역학 계산 함수를 하나 더 추가하면 된다.
   ===================================================================== */


// =====================================================================
// 1. CONFIG - 물리 상수 및 게임 설정값
// =====================================================================
const CONFIG = {
  // ---- 캔버스 ----
  CANVAS_WIDTH: 900,
  CANVAS_HEIGHT: 600,

  // ---- Stage별 중력 (동역학) ----
  GRAVITY: 1.62,              // [m/s^2] Stage 1: 달 표면 중력 근사값
  STAGE2_GRAVITY: 2.8,        // [m/s^2] Stage 1의 약 1.73배
  STAGE3_GRAVITY: 3.5,        // [m/s^2] Stage 2보다 조금 더 강함 (약 1.25배)
  STAGE4_GRAVITY: 6.5,        // [m/s^2] Stage 3보다 확실히 강함 (금성형 행성)

  // ---- 우주선 기본 물리 속성 (업그레이드의 기준이 되는 "Level 1" 값) ----
  SHIP_MASS: 500,             // [kg]
  SHIP_WIDTH: 26,             // [px]
  SHIP_HEIGHT: 38,            // [px]

  // ---- 추진력 ----
  THRUST_FORCE: 1300,         // [N] 메인 추진기 기본 힘
  ROTATION_TORQUE: 600,       // [유사 단위]
  MOMENT_OF_INERTIA: 400,     // [유사 단위] (업그레이드 대상 아님)

  // ---- 연료 ----
  FUEL_MAX: 200,
  FUEL_CONSUMPTION_RATE: 12,

  // ---- 착륙 판정 기준값 (모든 스테이지 공통) ----
  SAFE_VERTICAL_SPEED: 18,
  SAFE_HORIZONTAL_SPEED: 12,
  SAFE_ANGLE_DEG: 15,

  // ---- DANGER 표시 기준 ----
  DANGER_ALTITUDE: 160,
  DANGER_RATIO: 0.65,

  // ---- 지형 / 착륙 패드 ----
  GROUND_HEIGHT: 80,
  LANDING_PAD_WIDTH: 120,
  LANDING_PAD_CENTER_X: 460,

  // ---- 우주선 시작 위치 ----
  START_X: 260,
  START_Y: 70,

  // ---- 배경 ----
  STAR_COUNT: 120,

  // ---- 시뮬레이션 안정성 ----
  MAX_DT: 0.05,

  // ---- Stage 2+: 대기 / 항력 (F_drag = 0.5 * ρ * Cd * A * v_rel^2) ----
  AIR_DENSITY: 1.2,
  DRAG_COEFFICIENT: 0.9,
  SHIP_CROSS_SECTION: 18,

  // ---- Stage 2+: 바람 변화 ----
  WIND_MIN_STRENGTH: 1.5,
  WIND_MAX_STRENGTH: 6,
  WIND_CHANGE_INTERVAL_MIN: 4,
  WIND_CHANGE_INTERVAL_MAX: 8,
  WIND_SMOOTHING_RATE: 0.5,
};


// =====================================================================
// 2. HEAT - Stage 3 열역학 상수
// =====================================================================
const HEAT = {
  initialTemperature: 20,     // [°C] 시작 온도
  safeTemperature: 100,       // [°C] 이 온도까지는 100% 출력
  warningTemperature: 150,    // [°C] 이 온도부터 "HIGH TEMPERATURE" 경고
  criticalTemperature: 200,   // [°C] 이 온도부터 "ENGINE OVERHEAT" 경고
  overheatFloorTemperature: 250, // [°C] 이 온도부터 엔진 효율이 최저치로 고정됨
  meltdownTemperature: 260,   // [°C] 이 온도에 도달하면 엔진이 완전히 망가져 미션 실패

  minEngineEfficiency: 0.25,  // 과열 시 최저 엔진 효율 (25%)

  heatGenerationRate: 18,     // [°C/s] 엔진을 100% 사용할 때(thrustRatio=1) 초당 온도 상승량 (2배 증가)
  baseCoolingRate: 0.1,       // 냉각 계수(레벨1 기준). temperature -= baseCoolingRate*(temp-ambient)*dt
  aerodynamicHeatCoefficient: 0.01, // [°C/(N·s)] Stage4+: 항력 크기에 비례한 추가 발열 계수
};


// =====================================================================
// 3. shipStats / upgradeData / stages / saveData / gameState
// =====================================================================

const shipStats = {
  baseMass: CONFIG.SHIP_MASS,
  baseThrust: CONFIG.THRUST_FORCE,
  baseFuel: CONFIG.FUEL_MAX,
  baseRotationTorque: CONFIG.ROTATION_TORQUE,
};

// 업그레이드 정의. 새 업그레이드를 추가하려면 항목만 더 넣으면 됨.
const UPGRADE_DEFS = {
  engine: {
    name: "🚀 엔진 출력",
    statLabel: "추력",
    unit: "N",
    maxLevel: 5,
    multipliers: [1.0, 1.15, 1.30, 1.50, 1.75],
    costs: [100, 180, 300, 500],
    baseValue: () => shipStats.baseThrust,
  },
  lightweight: {
    name: "⚖️ 우주선 경량화",
    statLabel: "질량",
    unit: "kg",
    maxLevel: 5,
    multipliers: [1.0, 0.95, 0.90, 0.84, 0.78],
    costs: [120, 220, 350, 600],
    baseValue: () => shipStats.baseMass,
  },
  fuel: {
    name: "⛽ 연료 탱크",
    statLabel: "연료",
    unit: "",
    maxLevel: 5,
    multipliers: [1.0, 1.25, 1.50, 1.80, 2.20],
    costs: [80, 150, 250, 450],
    baseValue: () => shipStats.baseFuel,
  },
  attitude: {
    name: "🔄 자세 제어 장치",
    statLabel: "회전 속도",
    unit: "%",
    maxLevel: 5,
    multipliers: [1.0, 1.15, 1.30, 1.50, 1.75],
    costs: [100, 180, 300, 500],
    baseValue: () => 100,
  },
  // Stage 3이 해금된 이후에만 업그레이드 화면에 노출된다 (renderUpgradeUI 참고)
  cooling: {
    name: "❄️ 냉각 시스템",
    statLabel: "냉각 속도",
    unit: "%",
    maxLevel: 5,
    multipliers: [1.0, 1.20, 1.45, 1.75, 2.10],
    costs: [150, 300, 500, 800],
    baseValue: () => 100,
  },
  // Stage 4가 해금된 이후에만 업그레이드 화면에 노출된다 (renderUpgradeUI 참고)
  // 값이 작을수록 환경열/대기가열 유입이 더 많이 차단된다 (100% -> 35%)
  thermalShield: {
    name: "🛡️ 열 차폐",
    statLabel: "환경열 차단",
    unit: "%",
    maxLevel: 5,
    multipliers: [1.0, 0.85, 0.70, 0.50, 0.35],
    costs: [250, 450, 750, 1200],
    baseValue: () => 100,
  },
};

// 스테이지 설정: 스테이지별 물리/보상/기믹을 한 곳에서 관리한다.
// ★ Stage 4~5를 추가하려면 이 객체에 항목만 더 넣으면 된다.
const STAGES = {
  1: {
    id: 1,
    key: "stage1",
    title: "STAGE 1",
    subtitle: "약한 중력의 행성",
    physicsLabel: "동역학",
    difficultyStars: 1,
    gravity: CONFIG.GRAVITY,
    wind: false,
    thermodynamics: false,
    reward: 100,
  },
  2: {
    id: 2,
    key: "stage2",
    title: "STAGE 2",
    subtitle: "변화하는 바람의 행성",
    physicsLabel: "동역학 + 유체역학",
    difficultyStars: 2,
    gravity: CONFIG.STAGE2_GRAVITY,
    wind: true,
    thermodynamics: false,
    reward: 200,
  },
  3: {
    id: 3,
    key: "stage3",
    title: "STAGE 3",
    subtitle: "🔥 HEAT PLANET · 추력을 사용할수록 우주선이 뜨거워집니다.",
    physicsLabel: "동역학 + 유체역학 + 열역학",
    difficultyStars: 3,
    gravity: CONFIG.STAGE3_GRAVITY,
    wind: true,               // Stage 2의 대기/바람/항력을 그대로 유지
    thermodynamics: true,     // Stage 3에서만 열역학 시스템 활성화
    ambientTemperature: 40,   // [°C] Stage 3 행성의 주변 온도
    reward: 350,
  },
  4: {
    id: 4,
    key: "stage4",
    title: "STAGE 4",
    subtitle: "🔥 VENUS · 엔진을 꺼도 열은 식지 않는다.",
    warning: "⚠️ ENVIRONMENTAL WARNING\nEXTREME TEMPERATURE · ATMOSPHERIC DENSITY: HIGH · COOLING EFFICIENCY: LOW",
    physicsLabel: "동역학 + 유체역학 + 열역학(환경열 + 대기가열)",
    difficultyStars: 4,
    gravity: CONFIG.STAGE4_GRAVITY,
    wind: true,                    // Stage 2~3의 대기/바람/항력을 그대로 유지
    thermodynamics: true,
    ambientTemperature: 120,       // [°C] 매우 높은 주변 온도 - 식어도 결국 이 값에 가까워짐
    atmosphericDensity: 2.0,       // Stage2~3 대비 대기 밀도 배율 (항력 계산에 곱해짐)
    heatGenerationMultiplier: 1.35,// 같은 추력이라도 더 많은 열이 발생
    coolingMultiplier: 0.3,        // 냉각 효율이 Stage3의 약 30%로 대폭 감소
    aerodynamicHeating: true,      // 대기저항(항력)에 의한 추가 발열 활성화
    thermalShieldEnabled: true,    // 열 차폐 업그레이드가 환경열/대기가열을 감소시킴
    reward: 600,
  },
};

const gameState = {
  screen: "upgrade", // "upgrade" | "game"
};

// 디버깅용: true로 바꾸고 새로고침하면 저장 데이터가 초기화된다.
const RESET_SAVE = false;

const SAVE_KEY = "spaceshipLandingGame_saveData_v1";

// 재화 + 업그레이드 레벨 + 스테이지 해금 상태 (localStorage에 저장/복원)
const saveData = {
  credits: 0,
  upgrades: {
    engine: 1,
    lightweight: 1,
    fuel: 1,
    attitude: 1,
    cooling: 1,
    thermalShield: 1,
  },
  unlockedStages: {
    stage1: true,
    stage2: false,
    stage3: false,
    stage4: false,
  },
};

function loadSaveData() {
  if (RESET_SAVE) {
    localStorage.removeItem(SAVE_KEY);
  }
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);

    if (typeof parsed.credits === "number") {
      saveData.credits = parsed.credits;
    }
    if (parsed.upgrades) {
      for (const key of Object.keys(saveData.upgrades)) {
        if (typeof parsed.upgrades[key] === "number") {
          saveData.upgrades[key] = parsed.upgrades[key];
        }
      }
    }
    if (parsed.unlockedStages) {
      for (const key of Object.keys(saveData.unlockedStages)) {
        if (typeof parsed.unlockedStages[key] === "boolean") {
          saveData.unlockedStages[key] = parsed.unlockedStages[key];
        }
      }
    }
  } catch (err) {
    console.warn("저장 데이터를 불러오는 중 오류가 발생했습니다:", err);
  }
}

function persistSaveData() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
  } catch (err) {
    console.warn("저장 데이터를 기록하는 중 오류가 발생했습니다:", err);
  }
}


// =====================================================================
// 4. upgradeSystem - 업그레이드 레벨을 실제 물리값으로 변환
// =====================================================================

function getUpgradeMultiplier(key, level) {
  return UPGRADE_DEFS[key].multipliers[level - 1];
}

function getUpgradeCost(key, level) {
  const def = UPGRADE_DEFS[key];
  if (level >= def.maxLevel) return null;
  return def.costs[level - 1];
}

function isUpgradeMaxed(key) {
  return saveData.upgrades[key] >= UPGRADE_DEFS[key].maxLevel;
}

function canAffordUpgrade(key) {
  if (isUpgradeMaxed(key)) return false;
  const cost = getUpgradeCost(key, saveData.upgrades[key]);
  return saveData.credits >= cost;
}

function purchaseUpgrade(key) {
  if (!canAffordUpgrade(key)) return false;
  const level = saveData.upgrades[key];
  const cost = getUpgradeCost(key, level);
  saveData.credits -= cost;
  saveData.upgrades[key] = level + 1;
  persistSaveData();
  return true;
}

function getShipMass() {
  return shipStats.baseMass * getUpgradeMultiplier("lightweight", saveData.upgrades.lightweight);
}

function getShipThrust() {
  return shipStats.baseThrust * getUpgradeMultiplier("engine", saveData.upgrades.engine);
}

function getShipFuelMax() {
  return shipStats.baseFuel * getUpgradeMultiplier("fuel", saveData.upgrades.fuel);
}

function getShipRotationTorque() {
  return shipStats.baseRotationTorque * getUpgradeMultiplier("attitude", saveData.upgrades.attitude);
}

function getCoolingMultiplier() {
  return getUpgradeMultiplier("cooling", saveData.upgrades.cooling);
}

function getThermalShieldMultiplier() {
  return getUpgradeMultiplier("thermalShield", saveData.upgrades.thermalShield);
}

// ---- 스테이지 해금 관련 ----
function isStageUnlocked(stageId) {
  const stage = STAGES[stageId];
  return !!saveData.unlockedStages[stage.key];
}

function unlockStage(stageId) {
  const stage = STAGES[stageId];
  const wasLocked = !saveData.unlockedStages[stage.key];
  saveData.unlockedStages[stage.key] = true;
  return wasLocked; // 이번에 새로 해금됐으면 true
}


// =====================================================================
// 5. Vector2 - 2차원 벡터 클래스
// =====================================================================
class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  add(v) {
    return new Vector2(this.x + v.x, this.y + v.y);
  }

  subtract(v) {
    return new Vector2(this.x - v.x, this.y - v.y);
  }

  scale(s) {
    return new Vector2(this.x * s, this.y * s);
  }

  magnitude() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  clone() {
    return new Vector2(this.x, this.y);
  }

  static zero() {
    return new Vector2(0, 0);
  }
}

function normalizeAngle(angle) {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}


// =====================================================================
// 6. Planet - 행성 (중력 + 지면)
// =====================================================================
class Planet {
  constructor(gravity, groundY) {
    this.gravity = gravity;
    this.groundY = groundY;
  }
}


// =====================================================================
// 7. LandingPad - 착륙 패드
// =====================================================================
class LandingPad {
  constructor(centerX, width, groundY) {
    this.centerX = centerX;
    this.width = width;
    this.left = centerX - width / 2;
    this.right = centerX + width / 2;
    this.y = groundY;
  }

  contains(shipCenterX, shipHalfWidth) {
    return (
      shipCenterX - shipHalfWidth >= this.left &&
      shipCenterX + shipHalfWidth <= this.right
    );
  }
}


// =====================================================================
// 8. WindSystem (Stage 2+) - 시간에 따라 방향과 세기가 "부드럽게" 변하는 바람
// =====================================================================
class WindSystem {
  constructor() {
    this.current = new Vector2(0, 0);
    this.target = new Vector2(0, 0);
    this.timeToNextTarget = 0;
    this._pickNewTarget();
  }

  _pickNewTarget() {
    const angle = Math.random() * Math.PI * 2;
    const strength =
      CONFIG.WIND_MIN_STRENGTH +
      Math.random() * (CONFIG.WIND_MAX_STRENGTH - CONFIG.WIND_MIN_STRENGTH);

    this.target = new Vector2(Math.cos(angle), Math.sin(angle)).scale(strength);
    this.timeToNextTarget =
      CONFIG.WIND_CHANGE_INTERVAL_MIN +
      Math.random() * (CONFIG.WIND_CHANGE_INTERVAL_MAX - CONFIG.WIND_CHANGE_INTERVAL_MIN);
  }

  update(dt) {
    this.timeToNextTarget -= dt;
    if (this.timeToNextTarget <= 0) {
      this._pickNewTarget();
    }
    const lerpAmount = Math.min(1, CONFIG.WIND_SMOOTHING_RATE * dt);
    const diff = this.target.subtract(this.current);
    this.current = this.current.add(diff.scale(lerpAmount));
  }
}

function getWindArrowChar(vector) {
  const arrows = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
  let deg = (Math.atan2(vector.y, vector.x) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  const index = Math.round(deg / 45) % 8;
  return arrows[index];
}


// =====================================================================
// 9. thermodynamicsSystem (Stage 3) - 온도/엔진효율 계산 순수 함수들
//    Spaceship이나 Game 상태를 직접 건드리지 않고, 값만 받아 값을 돌려준다.
// =====================================================================

function lerp(a, b, t) {
  const clampedT = Math.max(0, Math.min(1, t));
  return a + (b - a) * clampedT;
}

// 온도 -> 엔진 효율(0~1). 20~100=100%, 100~150=100~85%, 150~200=85~50%,
// 200~250=50~25%, 250 이상=25% 고정. 구간 경계에서 값이 끊기지 않는(연속) 함수.
function computeEngineEfficiency(temperature) {
  const { safeTemperature, warningTemperature, criticalTemperature, overheatFloorTemperature, minEngineEfficiency } = HEAT;

  if (temperature <= safeTemperature) return 1.0;

  if (temperature <= warningTemperature) {
    const t = (temperature - safeTemperature) / (warningTemperature - safeTemperature);
    return lerp(1.0, 0.85, t);
  }

  if (temperature <= criticalTemperature) {
    const t = (temperature - warningTemperature) / (criticalTemperature - warningTemperature);
    return lerp(0.85, 0.50, t);
  }

  const t = (temperature - criticalTemperature) / (overheatFloorTemperature - criticalTemperature);
  return lerp(0.50, minEngineEfficiency, t);
}

function getHeatStatus(temperature) {
  if (temperature >= HEAT.criticalTemperature) return "OVERHEAT";
  if (temperature >= HEAT.warningTemperature) return "WARNING";
  return "NORMAL";
}


// =====================================================================
// 10. 물리 힘 계산 함수들 (역학별로 분리)
// =====================================================================

function computeGravityForce(ship, planet) {
  return new Vector2(0, ship.mass * planet.gravity);
}

function computeThrustForce(ship) {
  return ship.getThrustForce();
}

// 유체역학: 바람에 의한 항력. wind가 없으면(Stage1) 항상 0벡터 -> 기존 물리와 동일.
// stage.atmosphericDensity가 있으면(Stage4) 대기 밀도를 그만큼 배로 적용한다 (없으면 1배 = 기존과 동일).
function computeAerodynamicDragForce(ship, wind, stage) {
  if (!wind) return Vector2.zero();

  const relativeVelocity = ship.velocity.subtract(wind.current);
  const speed = relativeVelocity.magnitude();
  if (speed < 1e-4) return Vector2.zero();

  const densityMultiplier = (stage && stage.atmosphericDensity) || 1;
  const dragMagnitude =
    0.5 * CONFIG.AIR_DENSITY * densityMultiplier * CONFIG.DRAG_COEFFICIENT * CONFIG.SHIP_CROSS_SECTION * speed * speed;

  return relativeVelocity.scale(-dragMagnitude / speed);
}


// =====================================================================
// 11. Spaceship - 우주선의 물리 상태 & 운동 계산
// =====================================================================
class Spaceship {
  constructor(x, y) {
    this.mass = getShipMass();
    this.thrust = getShipThrust();
    this.rotationTorque = getShipRotationTorque();
    this.fuelMax = getShipFuelMax();

    this.width = CONFIG.SHIP_WIDTH;
    this.height = CONFIG.SHIP_HEIGHT;

    this.position = new Vector2(x, y);
    this.velocity = new Vector2(0, 0);
    this.acceleration = new Vector2(0, 0);

    this.angle = 0;
    this.angularVelocity = 0;

    this.fuel = this.fuelMax;

    // Stage 3 열역학 상태. thermodynamics가 꺼진 스테이지에서는 절대 갱신되지 않고
    // engineEfficiency가 항상 1.0으로 유지되어 추력에 아무 영향도 주지 않는다.
    this.temperature = HEAT.initialTemperature;
    this.engineEfficiency = 1.0;
    this.failureReason = null; // "LANDING_FAILURE" | "OUT_OF_FUEL" | "ENGINE_OVERHEAT"

    this.isThrusting = false;
    this.rotatingLeft = false;
    this.rotatingRight = false;

    this.status = "FLYING"; // "FLYING" | "LANDED" | "CRASHED"
  }

  getFacingDirection() {
    return new Vector2(Math.sin(this.angle), -Math.cos(this.angle));
  }

  // engineEfficiency는 Stage 3에서만 1.0이 아닌 값으로 바뀐다 (Game.updateEngineEfficiency 참고)
  getThrustForce() {
    if (!this.isThrusting || this.fuel <= 0) {
      return Vector2.zero();
    }
    return this.getFacingDirection().scale(this.thrust * this.engineEfficiency);
  }

  /**
   * @param {number} dt
   * @param {Planet} planet
   * @param {WindSystem|null} wind - 없으면 Stage 1과 동일 (항력 0)
   * @param {object} [stage] - 현재 스테이지 설정 (atmosphericDensity 등에 사용, 없으면 기본값)
   */
  update(dt, planet, wind, stage) {
    if (this.status !== "FLYING") return;

    // (1) 힘 계산: 중력 + 추력 + (Stage 2부터) 항력
    const gravityForce = computeGravityForce(this, planet);
    const thrustForce = computeThrustForce(this);
    const dragForce = computeAerodynamicDragForce(this, wind, stage);

    // TODO (4단계 - 고체역학): 착륙 충격/구조 응력은 checkLanding 쪽에서 확장한다.

    const netForce = gravityForce.add(thrustForce).add(dragForce);

    // (2) a = Fnet / m
    this.acceleration = netForce.scale(1 / this.mass);

    // (3) 오일러 적분: v = v + a*dt, x = x + v*dt
    this.velocity = this.velocity.add(this.acceleration.scale(dt));
    this.position = this.position.add(this.velocity.scale(dt));

    // (4) 회전 운동
    let torque = 0;
    if (this.rotatingLeft) torque -= this.rotationTorque;
    if (this.rotatingRight) torque += this.rotationTorque;

    const angularAcceleration = torque / CONFIG.MOMENT_OF_INERTIA;
    this.angularVelocity += angularAcceleration * dt;
    this.angle += this.angularVelocity * dt;

    // (5) 연료 소모
    if (this.isThrusting && this.fuel > 0) {
      this.fuel = Math.max(0, this.fuel - CONFIG.FUEL_CONSUMPTION_RATE * dt);
    }

    // (6) 화면 좌우 경계 clamp (핵심 물리 아님)
    const halfW = this.width / 2;
    if (this.position.x < halfW) {
      this.position.x = halfW;
      this.velocity.x = 0;
    } else if (this.position.x > CONFIG.CANVAS_WIDTH - halfW) {
      this.position.x = CONFIG.CANVAS_WIDTH - halfW;
      this.velocity.x = 0;
    }
  }

  getSpeed() {
    return this.velocity.magnitude();
  }

  getAltitude(planet) {
    return Math.max(0, planet.groundY - (this.position.y + this.height / 2));
  }

  getAngleDeg() {
    return (normalizeAngle(this.angle) * 180) / Math.PI;
  }
}


// =====================================================================
// 12. InputHandler - 키보드 입력만 담당
// =====================================================================
class InputHandler {
  constructor() {
    this.keys = new Set();
    this.restartRequested = false;

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "KeyR") this.restartRequested = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });
  }

  isThrustPressed() {
    return this.keys.has("KeyW") || this.keys.has("ArrowUp");
  }

  isLeftPressed() {
    return this.keys.has("KeyA") || this.keys.has("ArrowLeft");
  }

  isRightPressed() {
    return this.keys.has("KeyD") || this.keys.has("ArrowRight");
  }

  consumeRestart() {
    const requested = this.restartRequested;
    this.restartRequested = false;
    return requested;
  }
}


// =====================================================================
// 13. Renderer - Canvas에 "그리기"만 담당 (물리 계산 없음)
// =====================================================================
class Renderer {
  constructor(ctx) {
    this.ctx = ctx;
    this.stars = this._generateStars();
  }

  _generateStars() {
    const stars = [];
    for (let i = 0; i < CONFIG.STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * CONFIG.CANVAS_WIDTH,
        y: Math.random() * (CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT),
        r: Math.random() * 1.4 + 0.3,
        twinkle: Math.random() * Math.PI * 2,
      });
    }
    return stars;
  }

  clear() {
    const ctx = this.ctx;
    ctx.fillStyle = "#05070d";
    ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
  }

  drawStars(time) {
    const ctx = this.ctx;
    for (const star of this.stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(time * 0.002 + star.twinkle);
      ctx.globalAlpha = 0.4 + twinkle * 0.6;
      ctx.fillStyle = "#dfe8f5";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawGround(planet) {
    const ctx = this.ctx;
    ctx.fillStyle = "#1c2740";
    ctx.fillRect(0, planet.groundY, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT - planet.groundY);

    ctx.strokeStyle = "#3a4d70";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, planet.groundY);
    ctx.lineTo(CONFIG.CANVAS_WIDTH, planet.groundY);
    ctx.stroke();
  }

  drawLandingPad(pad) {
    const ctx = this.ctx;
    ctx.fillStyle = "#4fd6c9";
    ctx.fillRect(pad.left, pad.y - 4, pad.width, 6);

    ctx.strokeStyle = "#4fd6c9";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pad.left + 6, pad.y + 2);
    ctx.lineTo(pad.left + 6, pad.y + 14);
    ctx.moveTo(pad.right - 6, pad.y + 2);
    ctx.lineTo(pad.right - 6, pad.y + 14);
    ctx.stroke();

    ctx.fillStyle = "#ff9f4a";
    ctx.beginPath();
    ctx.arc(pad.left, pad.y - 4, 3, 0, Math.PI * 2);
    ctx.arc(pad.right, pad.y - 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  drawWindIndicator(wind) {
    const ctx = this.ctx;
    const speed = wind.current.magnitude();
    if (speed < 0.05) return;

    const angle = Math.atan2(wind.current.y, wind.current.x);
    const length = Math.min(90, 20 + speed * 8);
    const anchorX = CONFIG.CANVAS_WIDTH / 2;
    const anchorY = 34;

    ctx.save();
    ctx.translate(anchorX, anchorY);
    ctx.rotate(angle);

    ctx.strokeStyle = "rgba(90, 169, 255, 0.85)";
    ctx.fillStyle = "rgba(90, 169, 255, 0.85)";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(-length / 2, 0);
    ctx.lineTo(length / 2, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(length / 2, 0);
    ctx.lineTo(length / 2 - 8, -5);
    ctx.lineTo(length / 2 - 8, 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  // Stage 3: 우주선 엔진 부분에 온도에 따른 발광 효과(과열일수록 붉게)
  drawEngineHeatGlow(ship, heatStatus) {
    if (heatStatus === "NORMAL") return;
    const ctx = this.ctx;
    const color = heatStatus === "OVERHEAT" ? "rgba(255, 90, 95, 0.55)" : "rgba(255, 159, 74, 0.45)";

    ctx.save();
    ctx.translate(ship.position.x, ship.position.y);
    ctx.rotate(ship.angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, ship.height / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawShip(ship) {
    const ctx = this.ctx;
    const w = ship.width;
    const h = ship.height;

    ctx.save();
    ctx.translate(ship.position.x, ship.position.y);
    ctx.rotate(ship.angle);

    if (ship.isThrusting && ship.fuel > 0 && ship.status === "FLYING") {
      const flameLength = 14 + Math.random() * 10;
      ctx.fillStyle = "#ff9f4a";
      ctx.beginPath();
      ctx.moveTo(-w * 0.28, h / 2);
      ctx.lineTo(w * 0.28, h / 2);
      ctx.lineTo(0, h / 2 + flameLength);
      ctx.closePath();
      ctx.fill();
    }

    if (ship.rotatingLeft && ship.status === "FLYING") {
      ctx.fillStyle = "#5aa9ff";
      ctx.fillRect(w / 2, -h / 2, 8, 3);
    }
    if (ship.rotatingRight && ship.status === "FLYING") {
      ctx.fillStyle = "#5aa9ff";
      ctx.fillRect(-w / 2 - 8, -h / 2, 8, 3);
    }

    ctx.fillStyle = "#d7e2f0";
    ctx.strokeStyle = "#4fd6c9";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w / 2, h / 2 - 6);
    ctx.lineTo(w / 2, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.lineTo(-w / 2, h / 2 - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#4fd6c9";
    ctx.beginPath();
    ctx.arc(0, -h * 0.05, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  render(ship, planet, pad, time, wind, heatStatus) {
    this.clear();
    this.drawStars(time);
    this.drawGround(planet);
    this.drawLandingPad(pad);
    if (wind) this.drawWindIndicator(wind);
    if (heatStatus) this.drawEngineHeatGlow(ship, heatStatus);
    this.drawShip(ship);
  }
}


// =====================================================================
// 14. Game - 착륙 게임 메인 루프 (스테이지별 설정을 적용해서 실행)
// =====================================================================
class Game {
  constructor() {
    this.canvas = document.getElementById("gameCanvas");
    this.ctx = this.canvas.getContext("2d");

    this.pad = new LandingPad(
      CONFIG.LANDING_PAD_CENTER_X,
      CONFIG.LANDING_PAD_WIDTH,
      CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT
    );
    this.input = new InputHandler();
    this.renderer = new Renderer(this.ctx);

    this.hud = {
      stageName: document.getElementById("stage-name"),
      status: document.getElementById("status"),
      speed: document.getElementById("speed"),
      vSpeed: document.getElementById("vSpeed"),
      hSpeed: document.getElementById("hSpeed"),
      altitude: document.getElementById("altitude"),
      angle: document.getElementById("angle"),
      gravity: document.getElementById("gravity"),
      fuelFill: document.getElementById("fuel-bar-fill"),
      fuelPercent: document.getElementById("fuel-percent"),
      windPanel: document.getElementById("wind-panel"),
      windValue: document.getElementById("wind-value"),
      densityValue: document.getElementById("density-value"),
      heatPanel: document.getElementById("heat-panel"),
      heatFill: document.getElementById("heat-bar-fill"),
      heatValue: document.getElementById("heat-value"),
      engineEfficiencyValue: document.getElementById("engine-efficiency-value"),
      ambientValue: document.getElementById("ambient-value"),
      heatWarning: document.getElementById("heat-warning"),
      overlay: document.getElementById("message-overlay"),
      overlayText: document.getElementById("message-text"),
      overlayCredits: document.getElementById("message-credits"),
      overlaySub: document.getElementById("message-sub"),
      overlayBtn: document.getElementById("overlay-btn"),
    };
    this.hud.overlayBtn.addEventListener("click", () => goToUpgradeScreen());

    this.currentStageId = 1;
    this.stage = null;
    this.planet = null;
    this.wind = null;
    this.ship = null;
    this.startNewRun(1);

    this.lastTimestamp = null;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  startNewRun(stageId) {
    if (stageId) this.currentStageId = stageId;
    this.stage = STAGES[this.currentStageId];

    this.planet = new Planet(this.stage.gravity, CONFIG.CANVAS_HEIGHT - CONFIG.GROUND_HEIGHT);
    this.wind = this.stage.wind ? new WindSystem() : null;

    this.ship = new Spaceship(CONFIG.START_X, CONFIG.START_Y);

    const icon = this.stage.thermodynamics ? "🔥" : (this.stage.wind ? "🌪️" : "");
    this.hud.stageName.textContent = icon ? `${this.stage.title} ${icon}` : this.stage.title;
    this.hud.gravity.textContent = `${this.stage.gravity.toFixed(2)} m/s²`;
    this.hud.windPanel.classList.toggle("hidden", !this.stage.wind);
    this.hud.heatPanel.classList.toggle("hidden", !this.stage.thermodynamics);

    this.hud.overlay.classList.add("hidden");
    this.hud.overlay.classList.remove("landed", "crashed");
    this.hud.overlayCredits.classList.add("hidden");
    this.hud.overlayBtn.classList.add("hidden");
  }

  // ---- Stage 3/4: 열역학 ----
  // updateThermodynamics(dt) {
  //   updateHeatGeneration(dt);      // 엔진 열 (Stage3+)
  //   updateAerodynamicHeating(dt);  // 대기마찰/항력 열 (Stage4+, stage.aerodynamicHeating)
  //   updateCooling(dt);             // 냉각 + "환경 <-> 우주선" 양방향 열교환 (아래 설명 참고)
  //   updateEngineEfficiency();
  //   checkOverheat();
  // }
  // updateCooling()는 temperature -= rate*(temperature-ambient)*dt 형태라서, 우주선이 주변보다
  // 차가우면(Stage4처럼 ambient가 매우 높을 때) 이 항이 자동으로 "온도를 올리는" 방향으로 작동한다.
  // 즉 환경 -> 우주선으로의 열 유입(environmentHeatFlow)과 냉각이 수식 하나로 통합되어 있다.
  updateThermodynamics(dt) {
    this.updateHeatGeneration(dt);
    this.updateAerodynamicHeating(dt);
    this.updateCooling(dt);
    this.updateEngineEfficiency();
    this.checkOverheat();
  }

  // 엔진 출력(추력) × 작동 시간에 비례해 열이 발생한다.
  // thrustRatio = 현재(업그레이드 반영) 추력 / 기본(Level1) 추력 -> 엔진을 업그레이드할수록 더 빨리 뜨거워진다.
  // stage.heatGenerationMultiplier가 있으면(Stage4) 그만큼 발열이 더 커진다 (없으면 1배 = 기존과 동일).
  updateHeatGeneration(dt) {
    const ship = this.ship;
    if (ship.isThrusting && ship.fuel > 0) {
      const thrustRatio = ship.thrust / shipStats.baseThrust;
      const stageHeatMultiplier = this.stage.heatGenerationMultiplier || 1;
      ship.temperature += HEAT.heatGenerationRate * thrustRatio * stageHeatMultiplier * dt;
    }
  }

  // Stage4+: 대기(항력)와의 마찰로 발생하는 추가 발열. stage.aerodynamicHeating이 꺼져있으면
  // (Stage1~3) 아무 일도 하지 않아 기존 물리에 전혀 영향을 주지 않는다.
  // 열 차폐(thermalShield) 업그레이드가 있으면 이 발열도 함께 줄여준다.
  updateAerodynamicHeating(dt) {
    if (!this.stage.aerodynamicHeating) return;

    const dragForce = computeAerodynamicDragForce(this.ship, this.wind, this.stage);
    const dragMagnitude = dragForce.magnitude();
    if (dragMagnitude <= 0) return;

    let heatGain = dragMagnitude * HEAT.aerodynamicHeatCoefficient * dt;
    if (this.stage.thermalShieldEnabled) {
      heatGain *= getThermalShieldMultiplier();
    }
    this.ship.temperature += heatGain;
  }

  // 냉각 + 환경과의 열교환: 현재 온도가 주변 온도(ambient)에 가까워질수록 변화 속도가 느려진다.
  // temp > ambient 면 냉각(온도 하락), temp < ambient 면 환경이 우주선을 데움(온도 상승) - 둘 다 같은 식.
  // - 냉각 업그레이드(cooling)는 이 계수 자체를 높여준다.
  // - stage.coolingMultiplier가 있으면(Stage4) 전체 효율이 그만큼 깎인다 (없으면 1배 = 기존과 동일).
  // - "환경에서 들어오는" 방향(온도 상승)일 때만 열 차폐(thermalShield) 업그레이드가 그 유입량을 줄여준다.
  updateCooling(dt) {
    const ship = this.ship;
    const ambient = this.stage.ambientTemperature;
    const stageCoolingMultiplier = this.stage.coolingMultiplier ?? 1;
    const coolingRate = HEAT.baseCoolingRate * getCoolingMultiplier() * stageCoolingMultiplier;

    let delta = coolingRate * (ship.temperature - ambient) * dt;
    // delta < 0 : 환경이 우주선보다 뜨거워서 열이 "들어오는" 상황 -> 열 차폐로 유입량 감소
    if (delta < 0 && this.stage.thermalShieldEnabled) {
      delta *= getThermalShieldMultiplier();
    }

    const before = ship.temperature;
    ship.temperature -= delta;

    // 온도가 주변 온도를 "지나쳐서" 반대편으로 넘어가는 수치적 오버슈트만 막는다.
    // (주변 온도를 향해 정상적으로 접근하는 것 자체는 절대 막지 않는다 - 위/아래 모두)
    if ((before - ambient) * (ship.temperature - ambient) < 0) {
      ship.temperature = ambient;
    }
  }

  updateEngineEfficiency() {
    this.ship.engineEfficiency = computeEngineEfficiency(this.ship.temperature);
  }

  // 온도가 완전 위험 수위(meltdownTemperature)에 도달하면 엔진이 망가져 즉시 미션 실패 처리.
  checkOverheat() {
    const ship = this.ship;
    if (ship.status !== "FLYING") return;
    if (ship.temperature < HEAT.meltdownTemperature) return;

    ship.status = "CRASHED";
    ship.failureReason = "ENGINE_OVERHEAT";
    ship.velocity = Vector2.zero();
    ship.angularVelocity = 0;

    this.showMessage(
      "CRASH!",
      "crashed",
      null,
      "실패 원인: ENGINE OVERHEAT — R 키로 다시 도전하거나, 아래 버튼으로 미션 선택 화면으로 이동하세요"
    );
  }

  checkLanding() {
    const ship = this.ship;
    const groundContactY = this.planet.groundY - ship.height / 2;

    if (ship.position.y < groundContactY) return;

    ship.position.y = groundContactY;

    const verticalSpeed = Math.abs(ship.velocity.y);
    const horizontalSpeed = Math.abs(ship.velocity.x);
    const angleDeg = Math.abs(ship.getAngleDeg());

    const onPad = this.pad.contains(ship.position.x, ship.width / 2);
    const safeVertical = verticalSpeed <= CONFIG.SAFE_VERTICAL_SPEED;
    const safeHorizontal = horizontalSpeed <= CONFIG.SAFE_HORIZONTAL_SPEED;
    const safeAngle = angleDeg <= CONFIG.SAFE_ANGLE_DEG;

    if (onPad && safeVertical && safeHorizontal && safeAngle) {
      ship.status = "LANDED";
      ship.velocity = Vector2.zero();
      ship.angularVelocity = 0;

      const reward = this.stage.reward;
      saveData.credits += reward;

      let extraMsg = "";
      if (this.stage.id === 1 && unlockStage(2)) {
        extraMsg = " · 🔓 STAGE 2 UNLOCKED!";
      } else if (this.stage.id === 2 && unlockStage(3)) {
        extraMsg = " · 🔓 STAGE 3 UNLOCKED!";
      }
      persistSaveData();

      this.showMessage(
        "MISSION COMPLETE!",
        "landed",
        `+${reward} Credits${extraMsg}`,
        "아래 버튼을 눌러 미션 선택 화면으로 돌아가세요"
      );
    } else {
      ship.status = "CRASHED";
      ship.velocity = Vector2.zero();
      ship.angularVelocity = 0;
      ship.failureReason = ship.fuel <= 0 ? "OUT_OF_FUEL" : "LANDING_FAILURE";

      let subText = "R 키로 다시 도전하거나, 아래 버튼으로 미션 선택 화면으로 이동하세요";
      // Stage 1·2의 실패 문구는 이전과 완전히 동일하게 유지하고,
      // Stage 3(열역학 스테이지)에서만 실패 원인을 추가로 보여준다.
      if (this.stage.thermodynamics) {
        const reasonLabel = {
          LANDING_FAILURE: "LANDING FAILURE",
          OUT_OF_FUEL: "OUT OF FUEL",
          ENGINE_OVERHEAT: "ENGINE OVERHEAT",
        }[ship.failureReason];
        subText = `실패 원인: ${reasonLabel} — ${subText}`;
      }

      this.showMessage("CRASH!", "crashed", null, subText);
    }
  }

  showMessage(text, cssClass, creditsText, subText) {
    this.hud.overlay.classList.remove("hidden");
    this.hud.overlay.classList.add(cssClass);
    this.hud.overlayText.textContent = text;

    if (creditsText) {
      this.hud.overlayCredits.textContent = creditsText;
      this.hud.overlayCredits.classList.remove("hidden");
    } else {
      this.hud.overlayCredits.classList.add("hidden");
    }

    this.hud.overlaySub.textContent = subText || "";
    this.hud.overlayBtn.classList.remove("hidden");
  }

  computeFlightStatus() {
    const ship = this.ship;
    const altitude = ship.getAltitude(this.planet);
    if (altitude > CONFIG.DANGER_ALTITUDE) return "SAFE";

    const vSpeed = Math.abs(ship.velocity.y);
    const hSpeed = Math.abs(ship.velocity.x);
    const angleDeg = Math.abs(ship.getAngleDeg());

    const dangerV = vSpeed > CONFIG.SAFE_VERTICAL_SPEED * CONFIG.DANGER_RATIO;
    const dangerH = hSpeed > CONFIG.SAFE_HORIZONTAL_SPEED * CONFIG.DANGER_RATIO;
    const dangerA = angleDeg > CONFIG.SAFE_ANGLE_DEG * CONFIG.DANGER_RATIO;

    return (dangerV || dangerH || dangerA) ? "DANGER" : "SAFE";
  }

  updateHUD() {
    const ship = this.ship;
    const speed = ship.getSpeed();
    const vSpeed = Math.abs(ship.velocity.y);
    const hSpeed = Math.abs(ship.velocity.x);
    const altitude = ship.getAltitude(this.planet);
    const angleDeg = ship.getAngleDeg();

    this.hud.speed.textContent = `${speed.toFixed(1)} m/s`;
    this.hud.vSpeed.textContent = `${vSpeed.toFixed(1)} m/s`;
    this.hud.hSpeed.textContent = `${hSpeed.toFixed(1)} m/s`;
    this.hud.altitude.textContent = `${altitude.toFixed(1)} m`;
    this.hud.angle.textContent = `${angleDeg.toFixed(1)}°`;

    const fuelPercent = (ship.fuel / ship.fuelMax) * 100;
    this.hud.fuelFill.style.width = `${fuelPercent}%`;
    this.hud.fuelPercent.textContent = `${Math.round(fuelPercent)}%`;
    if (fuelPercent < 25) {
      this.hud.fuelFill.style.background = "linear-gradient(90deg, #ff5a5f, #ff9f4a)";
    } else {
      this.hud.fuelFill.style.background = "linear-gradient(90deg, #4fd6c9, #7be3d8)";
    }

    if (this.wind) {
      const windSpeed = this.wind.current.magnitude();
      this.hud.windValue.textContent = `${getWindArrowChar(this.wind.current)} ${windSpeed.toFixed(1)} m/s`;

      if (this.stage.atmosphericDensity) {
        const densityLabel = this.stage.atmosphericDensity >= 1.8 ? "HIGH" : "NORMAL";
        this.hud.densityValue.textContent = `ATMOSPHERIC DENSITY: ${densityLabel}`;
        this.hud.densityValue.classList.remove("hidden");
      } else {
        this.hud.densityValue.classList.add("hidden");
      }
    }

    if (this.stage.thermodynamics) {
      const heatPercent = Math.min(
        100,
        Math.max(0, ((ship.temperature - HEAT.initialTemperature) / (HEAT.overheatFloorTemperature - HEAT.initialTemperature)) * 100)
      );
      this.hud.heatFill.style.width = `${heatPercent}%`;
      this.hud.heatValue.textContent = `${Math.round(ship.temperature)}°C`;
      this.hud.engineEfficiencyValue.textContent = `ENGINE ${Math.round(ship.engineEfficiency * 100)}%`;
      this.hud.ambientValue.textContent = `AMBIENT ${Math.round(this.stage.ambientTemperature)}°C`;

      const heatStatus = getHeatStatus(ship.temperature);
      this.hud.heatPanel.classList.remove("heat-normal", "heat-warning", "heat-overheat");
      if (heatStatus === "OVERHEAT") {
        this.hud.heatPanel.classList.add("heat-overheat");
        this.hud.heatWarning.textContent = "🔥 ENGINE OVERHEAT\nTHRUST OUTPUT LIMITED";
        this.hud.heatWarning.classList.remove("hidden");
      } else if (heatStatus === "WARNING") {
        this.hud.heatPanel.classList.add("heat-warning");
        this.hud.heatWarning.textContent = "⚠️ HIGH TEMPERATURE";
        this.hud.heatWarning.classList.remove("hidden");
      } else {
        this.hud.heatPanel.classList.add("heat-normal");
        this.hud.heatWarning.classList.add("hidden");
      }
    }

    let statusText = ship.status;
    let statusClass = "status-safe";
    if (ship.status === "FLYING") {
      statusText = this.computeFlightStatus();
      statusClass = statusText === "DANGER" ? "status-danger" : "status-safe";
    } else if (ship.status === "LANDED") {
      statusClass = "status-landed";
    } else if (ship.status === "CRASHED") {
      statusClass = "status-crash";
    }
    this.hud.status.textContent = statusText;
    this.hud.status.className = `hud-value ${statusClass}`;
  }

  loop(timestamp) {
    if (this.lastTimestamp === null) this.lastTimestamp = timestamp;
    let dt = (timestamp - this.lastTimestamp) / 1000;
    dt = Math.min(dt, CONFIG.MAX_DT);
    this.lastTimestamp = timestamp;

    if (gameState.screen !== "game") {
      this.input.consumeRestart();
      requestAnimationFrame(this.loop);
      return;
    }

    if (this.input.consumeRestart()) {
      this.startNewRun();
    }

    if (this.ship.status === "FLYING") {
      this.ship.isThrusting = this.input.isThrustPressed();
      this.ship.rotatingLeft = this.input.isLeftPressed();
      this.ship.rotatingRight = this.input.isRightPressed();

      if (this.wind) this.wind.update(dt);

      // Stage 3에서만 열역학 계산 실행 (Stage 1·2는 절대 영향받지 않음)
      if (this.stage.thermodynamics) {
        this.updateThermodynamics(dt);
      }

      this.ship.update(dt, this.planet, this.wind, this.stage);
      this.checkLanding();
    }

    this.updateHUD();

    const heatStatusForRender = this.stage.thermodynamics ? getHeatStatus(this.ship.temperature) : null;
    this.renderer.render(this.ship, this.planet, this.pad, timestamp, this.wind, heatStatusForRender);

    requestAnimationFrame(this.loop);
  }
}


// =====================================================================
// 15. upgradeUI / stageSelectUI - 업그레이드 & 미션 선택 화면 렌더링
// =====================================================================

function formatStatValue(key, value) {
  const def = UPGRADE_DEFS[key];
  const rounded = Math.round(value);
  return def.unit ? `${rounded} ${def.unit}` : `${rounded}`;
}

function renderShipInfoPanel() {
  document.getElementById("info-mass").textContent = `${Math.round(getShipMass())} kg`;
  document.getElementById("info-thrust").textContent = `${Math.round(getShipThrust())} N`;
  document.getElementById("info-fuel").textContent = `${Math.round(getShipFuelMax())}`;
  document.getElementById("info-rotation").textContent =
    `${Math.round(getUpgradeMultiplier("attitude", saveData.upgrades.attitude) * 100)}%`;

  // 냉각 속도는 Stage 3이 해금된 이후에만 표시한다.
  const stage3Unlocked = isStageUnlocked(3);
  document.getElementById("info-cooling-row").classList.toggle("hidden", !stage3Unlocked);
  if (stage3Unlocked) {
    document.getElementById("info-cooling").textContent = `${Math.round(getCoolingMultiplier() * 100)}%`;
  }

  // 열 차폐(환경열 차단)는 Stage 4가 해금된 이후에만 표시한다.
  const stage4Unlocked = isStageUnlocked(4);
  document.getElementById("info-thermalshield-row").classList.toggle("hidden", !stage4Unlocked);
  if (stage4Unlocked) {
    document.getElementById("info-thermalshield").textContent = `${Math.round(getThermalShieldMultiplier() * 100)}%`;
  }
}

function renderUpgradeCard(key) {
  const def = UPGRADE_DEFS[key];
  const level = saveData.upgrades[key];
  const maxed = isUpgradeMaxed(key);

  const currentMultiplier = getUpgradeMultiplier(key, level);
  const currentValue = formatStatValue(key, def.baseValue() * currentMultiplier);

  let nextLine = "";
  let costLine = "";
  let buttonHtml = "";

  if (maxed) {
    nextLine = `<div class="upgrade-next">최대 레벨에 도달했습니다</div>`;
    buttonHtml = `<button class="upgrade-btn" disabled>MAX</button>`;
  } else {
    const nextMultiplier = getUpgradeMultiplier(key, level + 1);
    const nextValue = formatStatValue(key, def.baseValue() * nextMultiplier);
    const cost = getUpgradeCost(key, level);
    const affordable = saveData.credits >= cost;

    nextLine = `<div class="upgrade-next">다음 ${def.statLabel}: ${nextValue}</div>`;
    costLine = `<div class="upgrade-cost">업그레이드 비용: ${cost} Credits</div>`;
    buttonHtml = `<button class="upgrade-btn" data-upgrade-key="${key}" ${affordable ? "" : "disabled"}>업그레이드</button>`;
  }

  return `
    <div class="upgrade-card">
      <div class="upgrade-card-header">
        <span class="upgrade-name">${def.name}</span>
        <span class="upgrade-level">Lv.${level} / Lv.${def.maxLevel}</span>
      </div>
      <div class="upgrade-current">현재 ${def.statLabel}: ${currentValue}</div>
      ${nextLine}
      ${costLine}
      ${buttonHtml}
    </div>
  `;
}

function renderUpgradeUI() {
  document.getElementById("credits-value").textContent = saveData.credits;
  renderShipInfoPanel();

  // 냉각/열차폐 업그레이드 카드는 각각 Stage 3 / Stage 4가 해금된 이후에만 노출한다.
  const visibleKeys = Object.keys(UPGRADE_DEFS).filter((key) => {
    if (key === "cooling") return isStageUnlocked(3);
    if (key === "thermalShield") return isStageUnlocked(4);
    return true;
  });

  const container = document.getElementById("upgrade-cards");
  container.innerHTML = visibleKeys.map(renderUpgradeCard).join("");
}

function renderStageCard(stageIdStr) {
  const stageId = Number(stageIdStr);
  const stage = STAGES[stageId];
  const unlocked = isStageUnlocked(stageId);

  if (!unlocked) {
    const requiredStage = STAGES[stageId - 1];
    return `
      <div class="stage-card locked">
        <div class="stage-card-header">
          <span class="stage-name">🔒 ${stage.title}</span>
        </div>
        <div class="stage-locked-msg">${requiredStage.title}을 클리어하면 해금됩니다.</div>
        <button class="stage-btn" disabled>LOCKED</button>
      </div>
    `;
  }

  const icon = stage.thermodynamics ? "🔥" : (stage.wind ? "🌪️" : "🚀");
  const stars = "★".repeat(stage.difficultyStars);
  // 출격 전 환경 경고 (stage.warning이 있는 스테이지에서만 표시 - 현재는 Stage4)
  const warningHtml = stage.warning
    ? `<div class="stage-warning">${stage.warning.replace(/\n/g, "<br>")}</div>`
    : "";

  return `
    <div class="stage-card">
      <div class="stage-card-header">
        <span class="stage-name">${icon} ${stage.title}</span>
      </div>
      <div class="stage-subtitle">${stage.subtitle}</div>
      <div class="stage-meta">${stage.physicsLabel}</div>
      <div class="stage-meta">난이도 ${stars}</div>
      <div class="stage-reward">보상: ${stage.reward} Credits</div>
      ${warningHtml}
      <button class="stage-btn" data-stage-id="${stageId}">출격</button>
    </div>
  `;
}

function renderStageSelectUI() {
  const container = document.getElementById("stage-cards");
  container.innerHTML = Object.keys(STAGES).map(renderStageCard).join("");
}


// =====================================================================
// 16. 화면 전환 & 부트스트랩
// =====================================================================

let game = null;

function showScreen(name) {
  gameState.screen = name;
  document.getElementById("screen-upgrade").classList.toggle("hidden", name !== "upgrade");
  document.getElementById("screen-game").classList.toggle("hidden", name !== "game");
}

function goToUpgradeScreen() {
  showScreen("upgrade");
  renderUpgradeUI();
  renderStageSelectUI();
}

function goToGameScreen(stageId) {
  showScreen("game");
  game.startNewRun(stageId);
}

window.addEventListener("DOMContentLoaded", () => {
  loadSaveData();

  game = new Game();

  document.getElementById("upgrade-cards").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-upgrade-key]");
    if (!btn) return;
    const key = btn.dataset.upgradeKey;
    if (purchaseUpgrade(key)) {
      renderUpgradeUI();
    }
  });

  document.getElementById("stage-cards").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-stage-id]");
    if (!btn) return;
    const stageId = Number(btn.dataset.stageId);
    goToGameScreen(stageId);
  });

  renderUpgradeUI();
  renderStageSelectUI();
  showScreen("upgrade");
});