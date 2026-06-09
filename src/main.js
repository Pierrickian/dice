import './style.css'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import RULES from './rules.json'

// ─── Rules interpreter ────────────────────────────────────────────────────────

const ROUND = RULES.game.round_structure
const SCORING = RULES.game.scoring
const MAX_ROLLS = ROUND.max_rolls_per_round
const SCORE_RESET_THRESHOLD = SCORING.score_reset.threshold
const POINTS_PER_DIE = SCORING.per_die_banked.points
const RESULT_DISPLAY = RULES.game.result_display
const FACE_REVEAL_AFTER_FLOOR_CONTACT_SECONDS = RESULT_DISPLAY.face_reveal_after_floor_contact_seconds

const DEFAULT_LANGUAGE = 'fr'
const TRANSLATIONS = {
  fr: {
    diceCountLabel: 'Nombre de dés',
    diceFacesLabel: 'Nombre de faces',
    menuLabel: 'Menu',
    resetButton: 'Réinitialiser',
    toggleLanguageLabel: 'Passer en anglais',
    toggleLanguageFlag: '🇬🇧',
    rollHeader: (current, max) => `Lancer ${current} / ${max}`,
    scoreDisplay: score => `Score : ${score}`,
  },
  en: {
    diceCountLabel: 'Number of dice',
    diceFacesLabel: 'Number of sides',
    menuLabel: 'Menu',
    resetButton: 'Reset',
    toggleLanguageLabel: 'Switch to French',
    toggleLanguageFlag: '🇫🇷',
    rollHeader: (current, max) => `Roll ${current} / ${max}`,
    scoreDisplay: score => `Score: ${score}`,
  },
}
let currentLanguage = DEFAULT_LANGUAGE

function getTranslations() {
  return TRANSLATIONS[currentLanguage]
}

function getEarlyBonus(rollsUsed) {
  const entry = SCORING.early_finish_bonus.bonuses.find(b => b.rolls_used === rollsUsed)
  return entry ? entry.bonus_points : 0
}

const conditionHandlers = {
  highest_value(values, _params) {
    if (values.length === 0) return []
    const max = Math.max(...values)
    return values.map((v, i) => v === max ? i : -1).filter(i => i !== -1)
  },

  n_of_a_kind(values, params) {
    const countMap = {}
    values.forEach((v, i) => {
      if (v == null) return
      if (!countMap[v]) countMap[v] = []
      countMap[v].push(i)
    })
    const eligible = []
    for (const [, indices] of Object.entries(countMap)) {
      if (indices.length >= params.min_count) {
        if (params.eligible_count === 'all') {
          indices.forEach(i => eligible.push(i))
        } else {
          eligible.push(indices[0])
        }
      }
    }
    return eligible
  },

  pair_sum(values, params) {
    const eligible = []
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        if (values[i] != null && values[j] != null && values[i] + values[j] === params.target_sum) {
          if (params.eligible_count === 'all') {
            eligible.push(i, j)
          } else {
            eligible.push(i)
          }
        }
      }
    }
    return eligible
  },

  straight(values, params) {
    const unique = [...new Set(values.filter(v => v != null))].sort((a, b) => a - b)
    for (let i = 0; i <= unique.length - params.run_length; i++) {
      let isRun = true
      for (let k = 1; k < params.run_length; k++) {
        if (unique[i + k] !== unique[i] + k) { isRun = false; break }
      }
      if (isRun) {
        const runValues = unique.slice(i, i + params.run_length)
        const idx = values.findIndex(v => runValues.includes(v))
        if (idx !== -1) return [idx]
      }
    }
    return []
  },
}

function computeEligibleIndices(diceValues) {
  const eligible = new Set()
  for (const condition of RULES.game.banking_rules.conditions) {
    const handler = conditionHandlers[condition.engine.type]
    if (!handler) continue
    const indices = handler(diceValues, condition.engine)
    indices.forEach(i => eligible.add(i))
  }
  return eligible
}

// ─────────────────────────────────────────────────────────────────────────────

const app = document.querySelector('#app')
app.innerHTML = `
  <div id="ui">
    <button id="menu-button" type="button" aria-label="Menu">
      <span></span>
      <span></span>
      <span></span>
    </button>
    <button id="tuning-button" type="button" aria-label="Réglages">⚙</button>
    <button id="language-toggle" type="button" aria-label="Passer en anglais">🇬🇧</button>
    <div id="menu-panel" class="closed">
      <div class="control-row">
        <label id="dice-count-label" for="dice-count">Nombre de dés</label>
        <select id="dice-count">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4" selected>4</option>
          <option value="5">5</option>
          <option value="6">6</option>
        </select>
      </div>
      <div class="control-row">
        <label id="dice-faces-label" for="dice-faces">Nombre de faces</label>
        <select id="dice-faces">
          <option value="4">4</option>
          <option value="6" selected>6</option>
          <option value="8">8</option>
          <option value="10">10</option>
          <option value="12">12</option>
          <option value="20">20</option>
        </select>
      </div>
    </div>
    <div id="tuning-panel">
      <div id="friction-control">
        <label for="friction-slider">Sol</label>
        <input id="friction-slider" type="range" min="0.002" max="0.08" step="0.002" value="0.018">
        <output id="friction-value" for="friction-slider">0.018</output>
      </div>
      <div id="dice-friction-control">
        <label for="dice-friction-slider">Dés</label>
        <input id="dice-friction-slider" type="range" min="0.001" max="0.07" step="0.001" value="0.012">
        <output id="dice-friction-value" for="dice-friction-slider">0.012</output>
      </div>
      <div id="mass-control">
        <label for="mass-slider">Masse</label>
        <input id="mass-slider" type="range" min="0" max="10" step="0.5" value="6">
        <output id="mass-value" for="mass-slider">6.0 g</output>
      </div>
      <div id="throw-force-control">
        <label for="throw-force-slider">Force</label>
        <input id="throw-force-slider" type="range" min="0.02" max="0.45" step="0.01" value="0.20">
        <output id="throw-force-value" for="throw-force-slider">0.20</output>
      </div>
      <div id="throw-angle-control">
        <label for="throw-angle-slider">Altitude</label>
        <input id="throw-angle-slider" type="range" min="-10" max="10" step="1" value="0">
        <output id="throw-angle-value" for="throw-angle-slider">0°</output>
      </div>
    </div>
    <div id="roll-panel">
      <div id="roll-header">Lancer 1 / 3</div>
      <div id="score-display">Score : 0</div>
      <div id="dice-buttons" class="dice-buttons"></div>
      <div id="roll-controls">
        <button id="reset-button" type="button" class="secondary">Réinitialiser</button>
      </div>
    </div>
    <div id="aim-indicator"></div>
    <div id="score-animations"></div>
  </div>
  <canvas id="bg"></canvas>
`

const canvas = document.querySelector('#bg')
const diceCountSelect = document.querySelector('#dice-count')
const diceFacesSelect = document.querySelector('#dice-faces')
const menuButton = document.querySelector('#menu-button')
const menuPanel = document.querySelector('#menu-panel')
const tuningButton = document.querySelector('#tuning-button')
const tuningPanel = document.querySelector('#tuning-panel')
const languageToggle = document.querySelector('#language-toggle')
const diceCountLabel = document.querySelector('#dice-count-label')
const diceFacesLabel = document.querySelector('#dice-faces-label')
const rollHeader = document.querySelector('#roll-header')
const diceButtonsContainer = document.querySelector('#dice-buttons')
const resetButton = document.querySelector('#reset-button')
const scoreDisplay = document.querySelector('#score-display')
const scoreAnimations = document.querySelector('#score-animations')
const frictionSlider = document.querySelector('#friction-slider')
const frictionValue = document.querySelector('#friction-value')
const diceFrictionSlider = document.querySelector('#dice-friction-slider')
const diceFrictionValue = document.querySelector('#dice-friction-value')
const massSlider = document.querySelector('#mass-slider')
const massValue = document.querySelector('#mass-value')
const throwForceSlider = document.querySelector('#throw-force-slider')
const throwForceValue = document.querySelector('#throw-force-value')
const throwAngleSlider = document.querySelector('#throw-angle-slider')
const throwAngleValue = document.querySelector('#throw-angle-value')
const aimIndicator = document.querySelector('#aim-indicator')
resetButton.style.display = 'none'

const scene = new THREE.Scene()

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)
const CAMERA_DEFAULT_POSITION = new THREE.Vector3(0, 5.4, 7.3)
const CAMERA_DEFAULT_TARGET = new THREE.Vector3(0, 0, 0)
camera.position.copy(CAMERA_DEFAULT_POSITION)
camera.lookAt(CAMERA_DEFAULT_TARGET)
const cameraTarget = CAMERA_DEFAULT_TARGET.clone()
const cameraOffset = CAMERA_DEFAULT_POSITION.clone().sub(CAMERA_DEFAULT_TARGET)
const CAMERA_SCREEN_LOWER_TARGET_OFFSET = 3.4
const raycaster = new THREE.Raycaster()
const pointerNdc = new THREE.Vector2()
const dragStartScreen = new THREE.Vector2()
const dragCurrentScreen = new THREE.Vector2()
const activePointers = new Map()
const cameraPanOffset = new THREE.Vector3()
let cameraZoomScale = 1
let pinchInProgress = false
let pinchStartDistance = 0
let pinchStartZoomScale = 1

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
})
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

scene.background = new THREE.Color(0x1e1e2f)

const ambientLight = new THREE.AmbientLight(0xffffff, 1.2)
scene.add(ambientLight)

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.8)
directionalLight.position.set(5, 10, 7)
scene.add(directionalLight)

const floorGeometry = new THREE.PlaneGeometry(60, 60)
const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x2c2c3e,
  roughness: 0.9,
  metalness: 0.1,
})
const FLOOR_Y = -1.5
const floorPickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y)
const floor = new THREE.Mesh(floorGeometry, floorMaterial)
floor.rotation.x = -Math.PI / 2
floor.position.y = FLOOR_Y
scene.add(floor)

const world = new CANNON.World()
world.gravity.set(0, -9.81, 0)
world.allowSleep = true
world.solver.iterations = 14
world.solver.tolerance = 0.001

const diceMaterial = new CANNON.Material('dice')
const floorMaterialBody = new CANNON.Material('floor')
const contactMaterial = new CANNON.ContactMaterial(diceMaterial, floorMaterialBody, {
  friction: 0.018,
  restitution: 0.02,
  contactEquationStiffness: 1e7,
  contactEquationRelaxation: 4,
  frictionEquationStiffness: 1e7,
  frictionEquationRelaxation: 4,
})
const diceContactMaterial = new CANNON.ContactMaterial(diceMaterial, diceMaterial, {
  friction: 0.012,
  restitution: 0.02,
  contactEquationStiffness: 1e7,
  contactEquationRelaxation: 4,
  frictionEquationStiffness: 1e7,
  frictionEquationRelaxation: 4,
})
world.addContactMaterial(contactMaterial)
world.addContactMaterial(diceContactMaterial)
world.defaultContactMaterial.friction = 0.014
world.defaultContactMaterial.restitution = 0.02
const MIN_SIMULATED_DIE_MASS_KG = 0.0005
let dieMassKg = Number(massSlider.value) / 1000
const DEFAULT_FORCE_PER_KG = 0.2 / 0.006
let throwForceImpulse = Number(throwForceSlider.value)
let forceFollowsMass = true
let throwAltitudeAngleDeg = Number(throwAngleSlider.value)

function setGroundFriction(value) {
  contactMaterial.friction = value
  world.defaultContactMaterial.friction = Math.max(0.001, value * 0.75)
  frictionValue.textContent = value.toFixed(3)
}

setGroundFriction(Number(frictionSlider.value))

function setDiceFriction(value) {
  diceContactMaterial.friction = value
  diceFrictionValue.textContent = value.toFixed(3)
}

setDiceFriction(Number(diceFrictionSlider.value))

function getSimulatedDieMassKg() {
  return Math.max(MIN_SIMULATED_DIE_MASS_KG, dieMassKg)
}

function setDieMass(grams) {
  dieMassKg = grams / 1000
  massValue.textContent = `${grams.toFixed(1)} g`
  if (forceFollowsMass) {
    setThrowForce(getDefaultThrowForceForMass(), false)
  }
  dice.forEach((dieData) => {
    dieData.body.mass = getSimulatedDieMassKg()
    dieData.body.updateMassProperties()
    dieData.body.wakeUp()
  })
}

function getDefaultThrowForceForMass() {
  return THREE.MathUtils.clamp(getSimulatedDieMassKg() * DEFAULT_FORCE_PER_KG, 0.02, 0.45)
}

function setThrowForce(value, manual = true) {
  throwForceImpulse = value
  throwForceSlider.value = value.toFixed(2)
  throwForceValue.textContent = value.toFixed(2)
  if (manual) forceFollowsMass = false
}

function setThrowAltitudeAngle(degrees) {
  throwAltitudeAngleDeg = degrees
  throwAngleValue.textContent = `${degrees}°`
}

const floorBody = new CANNON.Body({
  mass: 0,
  shape: new CANNON.Plane(),
  position: new CANNON.Vec3(0, FLOOR_Y, 0),
  material: floorMaterialBody,
})
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
world.addBody(floorBody)

const clock = {
  lastTime: performance.now(),
  getDelta() {
    const now = performance.now()
    const delta = Math.min(1 / 30, (now - this.lastTime) / 1000)
    this.lastTime = now
    return delta
  },
}
const timeStep = 1 / 60
const FACE_SETTLE_DOT = 0.82
// The scene uses centimetre-sized dice: each die is normalized to about
// 1.2 cm across its widest dimension, keeping it inside the requested
// 1 cm to 1.5 cm range while preserving each polyhedral shape.
const DICE_TARGET_SIZE_CM = 1.2
const DICE_MIN_SIZE_CM = 1
const DICE_MAX_SIZE_CM = 1.5
const D6_BEVEL_RATIO = 0.08
const D6_FACE_NORMALS = [
  { value: 1, normal: new THREE.Vector3(0, 1, 0) },
  { value: 2, normal: new THREE.Vector3(0, 0, 1) },
  { value: 3, normal: new THREE.Vector3(1, 0, 0) },
  { value: 4, normal: new THREE.Vector3(-1, 0, 0) },
  { value: 5, normal: new THREE.Vector3(0, 0, -1) },
  { value: 6, normal: new THREE.Vector3(0, -1, 0) },
]
const CAMERA_FALLBACK_RADIUS = 1.4
const CAMERA_MARGIN = 1.12
const CAMERA_PAN_MAX_FACTOR = 0.75
const MAX_DRAG_DISTANCE = 2.8
const AIM_SUSPEND_HEIGHT = 2.15
const HAND_RADIUS = 2.05
const HAND_DAMPING = 0.58
const HAND_ANGULAR_DAMPING = 0.62
const HAND_MAX_DICE_SPEED = 1.05
const HAND_MAX_ANGULAR_SPEED = 4.5
const HAND_BOUNDARY_RESTITUTION = 0.08

let dice = []
let rollInProgress = false
let aimInProgress = false
let aimStartWorld = null
let aimCurrentWorld = null
let handSphereCenter = null
let handSphereRadius = HAND_RADIUS
let activePointerId = null
let pendingAimTimer = null
let pendingAimData = null
let currentFaces = Number(diceFacesSelect.value)
let currentRoll = 0
let scoreCumule = 0
let scoreGain = 0
let canFinishRound = false
let roundFinalized = false
let roundBonusApplied = false
let pendingRoundReset = false
let elapsedGameSeconds = 0

setDieMass(Number(massSlider.value))
setThrowAltitudeAngle(Number(throwAngleSlider.value))

const handSphere = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 18),
  new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.16,
    roughness: 0.3,
    metalness: 0.05,
    depthWrite: false,
  })
)
handSphere.visible = false
scene.add(handSphere)

function getKeepableDice() {
  const values = dice.map(d => d.value)
  return computeEligibleIndices(values)
}

function getDieColor(index) {
  const palette = [
    0xe63946,
    0xf4a261,
    0xe9c46a,
    0x2a9d8f,
    0x457b9d,
    0x6d597a,
  ]
  return palette[index % palette.length]
}

function formatRollHeader() {
  return getTranslations().rollHeader(currentRoll, MAX_ROLLS)
}

function updateRollUI() {
  rollHeader.textContent = formatRollHeader()
  resetButton.disabled = currentRoll === 0
}

function showScoreAnimation(text, dieData, isFinal = false) {
  const anim = document.createElement('div')
  anim.className = 'score-animation'
  if (isFinal) anim.classList.add('final')
  anim.textContent = text
  anim.style.left = `${Math.random() * 200 + 100}px`
  anim.style.top = `${Math.random() * 100 + 50}px`
  scoreAnimations.appendChild(anim)
  setTimeout(() => anim.remove(), 2000)
}

function updateScoreDisplay() {
  scoreDisplay.textContent = getTranslations().scoreDisplay(scoreCumule)
}

function applyLocalization() {
  const translations = getTranslations()
  document.documentElement.lang = currentLanguage
  menuButton.setAttribute('aria-label', translations.menuLabel)
  languageToggle.textContent = translations.toggleLanguageFlag
  languageToggle.setAttribute('aria-label', translations.toggleLanguageLabel)
  languageToggle.setAttribute('title', translations.toggleLanguageLabel)
  diceCountLabel.textContent = translations.diceCountLabel
  diceFacesLabel.textContent = translations.diceFacesLabel
  resetButton.textContent = translations.resetButton
  updateRollUI()
  updateScoreDisplay()
}

function toggleLanguage() {
  currentLanguage = currentLanguage === 'fr' ? 'en' : 'fr'
  applyLocalization()
}

function toggleMenu() {
  menuPanel.classList.toggle('open')
  tuningPanel.classList.remove('open')
}

function closeMenu() {
  menuPanel.classList.remove('open')
}

function toggleTuningMenu() {
  tuningPanel.classList.toggle('open')
  menuPanel.classList.remove('open')
}

function renderDiceButtons() {
  diceButtonsContainer.innerHTML = ''

  const keepable = getKeepableDice()

  dice.forEach((dieData, index) => {
    dieData.mesh.visible = !dieData.kept
    dieData.body.collisionResponse = !dieData.kept
    if (dieData.kept) {
      dieData.body.type = CANNON.Body.STATIC
    } else if (dieData.body.type === CANNON.Body.STATIC) {
      dieData.body.type = CANNON.Body.DYNAMIC
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dice-value-button'
    button.textContent = dieData.value == null ? '?' : dieData.value
    button.style.backgroundColor = `#${dieData.color.toString(16).padStart(6, '0')}`
    button.style.borderColor = `#${dieData.color.toString(16).padStart(6, '0')}`
    button.classList.toggle('kept', dieData.kept)
    button.classList.toggle('rolling', dieData.rolling)
    if (!keepable.has(index) && !dieData.kept && currentRoll < MAX_ROLLS) {
      button.classList.add('disabled')
    }

    button.addEventListener('click', () => {
      if (currentRoll === 0 || dieData.rolling || (!keepable.has(index) && !dieData.kept && currentRoll < MAX_ROLLS)) return
      dieData.kept = !dieData.kept
      button.classList.toggle('kept', dieData.kept)
      dieData.mesh.visible = !dieData.kept
      if (dieData.kept) {
        dieData.body.type = CANNON.Body.STATIC
        // Animation and score
        showScoreAnimation(`+${POINTS_PER_DIE}`, dieData)
        scoreGain += POINTS_PER_DIE
      } else {
        dieData.body.type = CANNON.Body.DYNAMIC
        dieData.body.wakeUp()
        scoreGain -= POINTS_PER_DIE
      }
      renderDiceButtons()
    })

    diceButtonsContainer.appendChild(button)
  })
}

const D4_VERTICES = [
  [1, 1, 1],
  [-1, -1, 1],
  [-1, 1, -1],
  [1, -1, -1],
].map(([x, y, z]) => [x / Math.sqrt(3), y / Math.sqrt(3), z / Math.sqrt(3)])

const D4_FACES = [
  [2, 3, 1],
  [3, 2, 0],
  [2, 1, 0],
  [1, 3, 0],
]
const POLY_DICE_DEFINITIONS = new Map()

function getPolyDieDefinition(faceCount) {
  if (!POLY_DICE_DEFINITIONS.has(faceCount)) {
    POLY_DICE_DEFINITIONS.set(faceCount, createPolyDieDefinition(faceCount))
  }
  return POLY_DICE_DEFINITIONS.get(faceCount)
}

function createPolyDieDefinition(faceCount) {
  switch (faceCount) {
    case 4:
      return buildPolyDieDefinition(D4_VERTICES, D4_FACES)
    case 8:
      return createD8Definition()
    case 10:
      return createD10Definition()
    case 12:
      return createD12Definition()
    case 20:
      return createD20Definition()
    default:
      return null
  }
}

function createDieGeometry(faceCount) {
  const definition = getPolyDieDefinition(faceCount)
  if (definition) return createPolyDieGeometry(definition, faceCount)

  switch (faceCount) {
    case 6: {
      const size = DICE_TARGET_SIZE_CM
      const bevel = size * D6_BEVEL_RATIO
      const geometry = new RoundedBoxGeometry(size, size, size, 4, bevel)
      geometry.userData.physicsDefinition = createBeveledBoxDefinition(size / 2, bevel)
      geometry.userData.faceNormals = D6_FACE_NORMALS
      return geometry
    }
    default: {
      const size = DICE_TARGET_SIZE_CM
      const bevel = size * D6_BEVEL_RATIO
      return new RoundedBoxGeometry(size, size, size, 4, bevel)
    }
  }
}

function createPolyDieGeometry(definition, faceCount) {
  validateDieSize(definition.sizeCm)
  const physicsDefinition = createBeveledPolyDieDefinition(definition, faceCount)
  const vertices = []
  for (const face of physicsDefinition.faces) {
    for (let i = 1; i < face.length - 1; i += 1) {
      vertices.push(...physicsDefinition.vertices[face[0]])
      vertices.push(...physicsDefinition.vertices[face[i]])
      vertices.push(...physicsDefinition.vertices[face[i + 1]])
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  geometry.userData.polyDefinition = definition
  geometry.userData.physicsDefinition = physicsDefinition
  geometry.userData.faceNormals = definition.faceNormals.map((normal, index) => ({
    value: index + 1,
    normal,
  }))
  return geometry
}

function getPolyBevelFactor(faceCount) {
  switch (faceCount) {
    case 4:
      return 0.1
    case 8:
      return 0.03
    case 10:
      return 0.022
    case 12:
      return 0.016
    case 20:
      return 0.01
    default:
      return 0.012
  }
}

function createBeveledPolyDieDefinition(definition, faceCount) {
  const bevel = getPolyBevelFactor(faceCount)
  const vertices = []
  const faces = []
  const faceVertexIndex = new Map()
  const originalVertexFaces = new Map()
  const edgeRecords = new Map()

  definition.faces.forEach((face, faceIndex) => {
    const faceCenter = face.reduce((sum, vertexIndex) => {
      const vertex = new THREE.Vector3(...definition.vertices[vertexIndex])
      return sum.add(vertex)
    }, new THREE.Vector3()).multiplyScalar(1 / face.length)

    const insetFace = face.map((vertexIndex) => {
      const vertex = new THREE.Vector3(...definition.vertices[vertexIndex])
      vertex.lerp(faceCenter, bevel)
      const newIndex = vertices.length
      vertices.push([vertex.x, vertex.y, vertex.z])
      faceVertexIndex.set(`${faceIndex}:${vertexIndex}`, newIndex)

      if (!originalVertexFaces.has(vertexIndex)) originalVertexFaces.set(vertexIndex, [])
      originalVertexFaces.get(vertexIndex).push(faceIndex)
      return newIndex
    })
    faces.push(insetFace)

    for (let i = 0; i < face.length; i += 1) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      if (!edgeRecords.has(key)) edgeRecords.set(key, [])
      edgeRecords.get(key).push({ faceIndex, a, b })
    }
  })

  edgeRecords.forEach((records) => {
    if (records.length !== 2) return
    const [first, second] = records
    faces.push([
      faceVertexIndex.get(`${first.faceIndex}:${first.a}`),
      faceVertexIndex.get(`${first.faceIndex}:${first.b}`),
      faceVertexIndex.get(`${second.faceIndex}:${first.b}`),
      faceVertexIndex.get(`${second.faceIndex}:${first.a}`),
    ])
  })

  originalVertexFaces.forEach((faceIndices, vertexIndex) => {
    if (faceIndices.length < 3) return
    const axis = new THREE.Vector3(...definition.vertices[vertexIndex]).normalize()
    const reference = new THREE.Vector3(...vertices[faceVertexIndex.get(`${faceIndices[0]}:${vertexIndex}`)])
      .projectOnPlane(axis)
      .normalize()
    const tangent = new THREE.Vector3().crossVectors(axis, reference).normalize()
    const cornerFace = faceIndices
      .map(faceIndex => faceVertexIndex.get(`${faceIndex}:${vertexIndex}`))
      .sort((a, b) => {
        const pa = new THREE.Vector3(...vertices[a]).projectOnPlane(axis).normalize()
        const pb = new THREE.Vector3(...vertices[b]).projectOnPlane(axis).normalize()
        return Math.atan2(pa.dot(tangent), pa.dot(reference)) -
          Math.atan2(pb.dot(tangent), pb.dot(reference))
      })
    faces.push(cornerFace)
  })

  return {
    vertices,
    faces: orientFacesOutward(vertices, faces),
    faceNormals: definition.faceNormals,
    faceDistances: definition.faceDistances,
  }
}

function createBeveledBoxDefinition(halfSize, bevelRadius) {
  const inset = halfSize - bevelRadius
  const vertices = []
  const vertexMap = new Map()
  const faces = []

  function addVertex(x, y, z) {
    const key = `${x}:${y}:${z}`
    if (!vertexMap.has(key)) {
      vertexMap.set(key, vertices.length)
      vertices.push([x, y, z])
    }
    return vertexMap.get(key)
  }

  function addFace(points) {
    faces.push(points.map(([x, y, z]) => addVertex(x, y, z)))
  }

  const h = halfSize
  const s = inset
  const signs = [-1, 1]

  addFace([[h, -s, -s], [h, s, -s], [h, s, s], [h, -s, s]])
  addFace([[-h, -s, s], [-h, s, s], [-h, s, -s], [-h, -s, -s]])
  addFace([[-s, h, -s], [-s, h, s], [s, h, s], [s, h, -s]])
  addFace([[-s, -h, s], [-s, -h, -s], [s, -h, -s], [s, -h, s]])
  addFace([[-s, -s, h], [s, -s, h], [s, s, h], [-s, s, h]])
  addFace([[-s, s, -h], [s, s, -h], [s, -s, -h], [-s, -s, -h]])

  for (const y of signs) {
    for (const z of signs) {
      addFace([[-s, y * h, z * s], [s, y * h, z * s], [s, y * s, z * h], [-s, y * s, z * h]])
    }
  }
  for (const x of signs) {
    for (const z of signs) {
      addFace([[x * h, -s, z * s], [x * h, s, z * s], [x * s, s, z * h], [x * s, -s, z * h]])
    }
  }
  for (const x of signs) {
    for (const y of signs) {
      addFace([[x * h, y * s, -s], [x * h, y * s, s], [x * s, y * h, s], [x * s, y * h, -s]])
    }
  }
  for (const x of signs) {
    for (const y of signs) {
      for (const z of signs) {
        addFace([[x * h, y * s, z * s], [x * s, y * h, z * s], [x * s, y * s, z * h]])
      }
    }
  }

  return {
    vertices,
    faces: orientFacesOutward(vertices, faces),
  }
}

function buildPolyDieDefinition(vertices, faces) {
  const centeredVertices = centerVertices(vertices)
  const scaledVertices = scaleVerticesToTargetSize(centeredVertices, DICE_TARGET_SIZE_CM)
  const orientedFaces = orientFacesOutward(scaledVertices, faces)
  const faceNormals = orientedFaces.map(face => getFaceNormalFromVertexList(scaledVertices, face))
  const faceDistances = orientedFaces.map((face, index) => (
    Math.abs(faceNormals[index].dot(new THREE.Vector3(...scaledVertices[face[0]])))
  ))
  return {
    vertices: scaledVertices,
    faces: orientedFaces,
    faceNormals,
    faceDistances,
    sizeCm: getMaxDimension(scaledVertices),
  }
}

function scaleVerticesToTargetSize(vertices, targetSize) {
  const currentSize = getMaxDimension(vertices)
  const scale = currentSize > 0 ? targetSize / currentSize : 1
  return vertices.map(vertex => vertex.map(coordinate => coordinate * scale))
}

function getMaxDimension(vertices) {
  const bounds = getVertexBounds(vertices)
  return Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2]
  )
}

function getVertexBounds(vertices) {
  return vertices.reduce((bounds, vertex) => ({
    min: bounds.min.map((value, index) => Math.min(value, vertex[index])),
    max: bounds.max.map((value, index) => Math.max(value, vertex[index])),
  }), {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  })
}

function validateDieSize(sizeCm) {
  if (sizeCm < DICE_MIN_SIZE_CM || sizeCm > DICE_MAX_SIZE_CM) {
    throw new Error(`Die geometry size ${sizeCm.toFixed(2)} cm is outside the requested 1 cm to 1.5 cm range.`)
  }
}

function centerVertices(vertices) {
  const center = vertices.reduce(
    (sum, vertex) => [
      sum[0] + vertex[0],
      sum[1] + vertex[1],
      sum[2] + vertex[2],
    ],
    [0, 0, 0]
  ).map(value => value / vertices.length)

  return vertices.map(vertex => [
    vertex[0] - center[0],
    vertex[1] - center[1],
    vertex[2] - center[2],
  ])
}

function orientFacesOutward(vertices, faces) {
  return faces.map((face) => {
    const normal = getFaceNormalFromVertexList(vertices, face)
    const faceCenter = face.reduce(
      (sum, index) => [
        sum[0] + vertices[index][0],
        sum[1] + vertices[index][1],
        sum[2] + vertices[index][2],
      ],
      [0, 0, 0]
    ).map(value => value / face.length)
    return normal.dot(new THREE.Vector3(...faceCenter)) < 0 ? [...face].reverse() : [...face]
  })
}

function getFaceNormalFromVertexList(vertices, face) {
  const a = new THREE.Vector3(...vertices[face[0]])
  const b = new THREE.Vector3(...vertices[face[1]])
  const c = new THREE.Vector3(...vertices[face[2]])
  return b.sub(a).cross(c.sub(a)).normalize()
}

function createD8Definition() {
  return buildPolyDieDefinition(
    [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ],
    [
      [0, 2, 4],
      [4, 2, 1],
      [1, 2, 5],
      [5, 2, 0],
      [4, 3, 0],
      [1, 3, 4],
      [5, 3, 1],
      [0, 3, 5],
    ]
  )
}

function createD10Definition() {
  const radius = 1
  const topZ = 1.1
  const midZ = topZ * 0.10557280900008409
  const vertices = []
  const faces = []

  vertices.push([0, 0, topZ])
  vertices.push([0, 0, -topZ])

  const ringCount = 5
  for (let i = 0; i < ringCount; i += 1) {
    const angle = (i * Math.PI * 2) / ringCount
    vertices.push([radius * Math.cos(angle), radius * Math.sin(angle), midZ])
  }
  for (let i = 0; i < ringCount; i += 1) {
    const angle = (i * Math.PI * 2) / ringCount + Math.PI / ringCount
    vertices.push([radius * Math.cos(angle), radius * Math.sin(angle), -midZ])
  }

  vertices[0] = [0, 0, topZ]
  vertices[1] = [0, 0, -topZ]

  for (let i = 0; i < ringCount; i += 1) {
    const next = (i + 1) % ringCount
    const upperA = 2 + i
    const upperB = 2 + next
    const lowerA = 2 + ringCount + i
    const lowerB = 2 + ringCount + next

    faces.push([0, upperA, lowerA, upperB])
    faces.push([1, lowerA, upperB, lowerB])
  }

  return buildPolyDieDefinition(vertices, faces)
}

function createD20Definition() {
  return buildPolyDieDefinition(createIcosahedronVertices(), createIcosahedronFaces())
}

function createD12Definition() {
  const icosaVertices = createIcosahedronVertices()
  const icosaFaces = orientFacesOutward(icosaVertices, createIcosahedronFaces())
  const dodecaVertices = icosaFaces.map(face => {
    const normal = getFaceNormalFromVertexList(icosaVertices, face)
    return [normal.x, normal.y, normal.z]
  })

  const dodecaFaces = icosaVertices.map((vertex, vertexIndex) => {
    const axis = new THREE.Vector3(...vertex).normalize()
    const adjacent = []
    icosaFaces.forEach((face, faceIndex) => {
      if (face.includes(vertexIndex)) adjacent.push(faceIndex)
    })

    const reference = new THREE.Vector3(...dodecaVertices[adjacent[0]])
      .projectOnPlane(axis)
      .normalize()
    const tangent = new THREE.Vector3().crossVectors(axis, reference).normalize()

    return adjacent.sort((a, b) => {
      const pa = new THREE.Vector3(...dodecaVertices[a]).projectOnPlane(axis).normalize()
      const pb = new THREE.Vector3(...dodecaVertices[b]).projectOnPlane(axis).normalize()
      const angleA = Math.atan2(pa.dot(tangent), pa.dot(reference))
      const angleB = Math.atan2(pb.dot(tangent), pb.dot(reference))
      return angleA - angleB
    })
  })

  return buildPolyDieDefinition(dodecaVertices, dodecaFaces)
}

function createIcosahedronVertices() {
  const phi = (1 + Math.sqrt(5)) / 2
  return normalizeVertices([
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ])
}

function createIcosahedronFaces() {
  return [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ]
}

function normalizeVertices(vertices) {
  return vertices.map(([x, y, z]) => {
    const length = Math.sqrt(x * x + y * y + z * z) || 1
    return [x / length, y / length, z / length]
  })
}

function createDie(x, z, index) {
  const geometry = createDieGeometry(currentFaces)
  const definition = geometry.userData.polyDefinition
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const color = getDieColor(index)
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.15,
  })
  const die = new THREE.Mesh(geometry, material)
  const startPosition = new THREE.Vector3(x, 0.5, z)
  const startQuaternion = new THREE.Quaternion()
  if (definition) {
    startPosition.y = FLOOR_Y + definition.faceDistances[0]
    startQuaternion.copy(getFaceDownQuaternion(definition, 0))
  }
  die.position.copy(startPosition)
  die.quaternion.copy(startQuaternion)
  scene.add(die)

  const shape = createPhysicsShape(geometry, currentFaces)
  const body = new CANNON.Body({
    mass: getSimulatedDieMassKg(),
    shape,
    position: new CANNON.Vec3(startPosition.x, startPosition.y, startPosition.z),
    linearDamping: 0.5,
    angularDamping: 0.62,
    material: diceMaterial,
  })
  body.quaternion.set(startQuaternion.x, startQuaternion.y, startQuaternion.z, startQuaternion.w)
  body.allowSleep = true
  body.sleepSpeedLimit = 0.22
  body.sleepTimeLimit = 0.22
  world.addBody(body)

  return {
    mesh: die,
    body,
    color,
    value: null,
    rolling: false,
    kept: false,
    floorContactAtSeconds: null,
    aimOrientationLocked: false,
    defaultLinearDamping: body.linearDamping,
    defaultAngularDamping: body.angularDamping,
    index,
  }
}

function getFaceDownQuaternion(definition, faceIndex) {
  const normal = definition.faceNormals[faceIndex].clone().normalize()
  return new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, -1, 0))
}

function clearDice() {
  for (const dieData of dice) {
    scene.remove(dieData.mesh)
    world.removeBody(dieData.body)
    dieData.mesh.geometry.dispose()
    dieData.mesh.material.dispose()
  }
  dice = []
}

function createPhysicsShape(geometry, faceCount) {
  const definition = geometry.userData.physicsDefinition || geometry.userData.polyDefinition
  if (definition) {
    return new CANNON.ConvexPolyhedron({
      vertices: definition.vertices.map(([x, y, z]) => new CANNON.Vec3(x, y, z)),
      faces: definition.faces,
    })
  }

  if (faceCount === 6) {
    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    const halfSize = new CANNON.Vec3(
      (box.max.x - box.min.x) / 2,
      (box.max.y - box.min.y) / 2,
      (box.max.z - box.min.z) / 2
    )
    return new CANNON.Box(halfSize)
  } else {
    geometry.computeBoundingSphere()
    const radius = geometry.boundingSphere?.radius || 1
    return new CANNON.Sphere(radius * 0.92)
  }
}

function createDice(count) {
  clearDice()
  currentRoll = 0
  rollInProgress = false
  canFinishRound = false
  roundFinalized = false
  roundBonusApplied = false
  pendingRoundReset = false
  scoreGain = 0
  diceButtonsContainer.innerHTML = ''

  const radius = Math.min(2.5, 0.9 + (count - 1) * 0.3)
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius
    dice.push(createDie(x, z, i))
  }

  updateRollUI()
  updateScoreDisplay()
  renderDiceButtons()
  closeMenu()
}

function getRollableDice() {
  return dice.filter(dieData => !dieData.kept || currentRoll === 0)
}

function getHandDiceOffset(index, count) {
  if (count <= 1) return new THREE.Vector3(0, 0, 0)
  const angle = (index / count) * Math.PI * 2
  const ringRadius = Math.min(HAND_RADIUS * 0.32, HAND_RADIUS - DICE_TARGET_SIZE_CM * 0.75)
  return new THREE.Vector3(
    Math.cos(angle) * ringRadius,
    (index % 2) * 0.12 - 0.06,
    Math.sin(angle) * ringRadius
  )
}

function updateHandSphere(center) {
  handSphereCenter = center.clone()
  handSphereCenter.y = FLOOR_Y + AIM_SUSPEND_HEIGHT
  handSphereRadius = HAND_RADIUS
  handSphere.position.copy(handSphereCenter)
  handSphere.scale.setScalar(handSphereRadius)
  handSphere.visible = true
}

function beginHandAim(center) {
  const activeDice = getRollableDice()
  updateHandSphere(center)
  activeDice.forEach((dieData, index) => {
    const body = dieData.body
    const offset = getHandDiceOffset(index, activeDice.length)
    dieData.value = null
    dieData.rolling = false
    dieData.floorContactAtSeconds = null
    dieData.mesh.visible = true
    dieData.aimOrientationLocked = false
    body.mass = getSimulatedDieMassKg()
    body.type = CANNON.Body.DYNAMIC
    body.collisionResponse = true
    body.linearDamping = HAND_DAMPING
    body.angularDamping = HAND_ANGULAR_DAMPING
    body.position.set(
      handSphereCenter.x + offset.x,
      handSphereCenter.y + offset.y,
      handSphereCenter.z + offset.z
    )
    body.velocity.set(0, 0, 0)
    body.updateMassProperties()
    body.wakeUp()
  })
  syncPhysics()
  renderDiceButtons()
}

function moveHandAim(center) {
  if (!handSphereCenter) {
    updateHandSphere(center)
    return
  }
  updateHandSphere(center)
}

function containAimedDiceInHandSphere() {
  if (!aimInProgress || !handSphereCenter) return

  const maxDistance = Math.max(0.28, handSphereRadius - DICE_TARGET_SIZE_CM * 0.55)
  const center = new CANNON.Vec3(handSphereCenter.x, handSphereCenter.y, handSphereCenter.z)
  getRollableDice().forEach((dieData) => {
    const body = dieData.body
    const fromCenter = body.position.vsub(center)
    const distance = fromCenter.length()

    if (distance > maxDistance) {
      const normal = fromCenter.scale(1 / Math.max(distance, 0.0001))
      body.position.copy(center.vadd(normal.scale(maxDistance)))
      const outwardSpeed = body.velocity.dot(normal)
      if (outwardSpeed > 0) {
        body.velocity.vsub(normal.scale(outwardSpeed * (1 + HAND_BOUNDARY_RESTITUTION)), body.velocity)
      }
    }

    limitAimedDieVelocity(body)
  })
}

function limitAimedDieVelocity(body) {
  if (body.velocity.length() > HAND_MAX_DICE_SPEED) {
    body.velocity.normalize()
    body.velocity.scale(HAND_MAX_DICE_SPEED, body.velocity)
  }
  if (body.angularVelocity.length() > HAND_MAX_ANGULAR_SPEED) {
    body.angularVelocity.normalize()
    body.angularVelocity.scale(HAND_MAX_ANGULAR_SPEED, body.angularVelocity)
  }
}

function hideHandSphere() {
  handSphere.visible = false
  handSphereCenter = null
}

function releaseAimedDice() {
  hideHandSphere()
  const activeDice = getRollableDice()
  activeDice.forEach((dieData) => {
    dieData.aimOrientationLocked = false
    dieData.body.mass = getSimulatedDieMassKg()
    dieData.body.type = CANNON.Body.DYNAMIC
    dieData.body.collisionResponse = true
    dieData.body.linearDamping = dieData.defaultLinearDamping
    dieData.body.angularDamping = dieData.defaultAngularDamping
    dieData.body.updateMassProperties()
    dieData.body.wakeUp()
  })
}

function applyDieImpulse(dieData, launchVector, forceRatio) {
  const body = dieData.body
  const centeredIndex = dieData.index - (dice.length - 1) / 2
  const sideScatter = -centeredIndex * 0.0015 + (Math.random() - 0.5) * 0.006
  const altitudeRadians = THREE.MathUtils.degToRad(throwAltitudeAngleDeg)
  const horizontalForce = throwForceImpulse * Math.cos(altitudeRadians) * forceRatio
  const verticalForce = throwForceImpulse * Math.sin(altitudeRadians) * forceRatio
  const impulse = new CANNON.Vec3(
    launchVector.x * horizontalForce,
    verticalForce,
    launchVector.z * horizontalForce + sideScatter
  )
  const offCenter = new CANNON.Vec3(
    (Math.random() - 0.5) * 0.45,
    (Math.random() - 0.5) * 0.18,
    (Math.random() - 0.5) * 0.45
  )
  body.applyImpulse(impulse, offCenter)
  body.angularVelocity.set(
    launchVector.z * 3.8 + (Math.random() - 0.5) * 1.8,
    (Math.random() - 0.5) * 3.2,
    -launchVector.x * 3.8 + (Math.random() - 0.5) * 1.8
  )
}

function syncPhysics() {
  dice.forEach((dieData) => {
    dieData.mesh.position.copy(dieData.body.position)
    dieData.mesh.quaternion.set(
      dieData.body.quaternion.x,
      dieData.body.quaternion.y,
      dieData.body.quaternion.z,
      dieData.body.quaternion.w
    )
  })
}

function isBodyTouchingFloor(body) {
  return world.contacts.some((contact) =>
    (contact.bi === body && contact.bj === floorBody) ||
    (contact.bi === floorBody && contact.bj === body)
  )
}

function updateDiceFloorContactTimes() {
  dice.forEach((dieData) => {
    if (dieData.kept || !dieData.rolling || dieData.floorContactAtSeconds != null) return
    if (isBodyTouchingFloor(dieData.body)) {
      dieData.floorContactAtSeconds = elapsedGameSeconds
    }
  })
}

function hasDieReachedFaceRevealDelay(dieData) {
  return dieData.floorContactAtSeconds != null &&
    elapsedGameSeconds - dieData.floorContactAtSeconds >= FACE_REVEAL_AFTER_FLOOR_CONTACT_SECONDS
}

function updateRealtimeDieFaceValues() {
  let hasChanged = false
  dice.forEach((dieData) => {
    if (dieData.kept || !dieData.rolling || !hasDieReachedFaceRevealDelay(dieData)) return
    const nextValue = determineDieFaceValue(dieData)
    if (dieData.value !== nextValue) {
      dieData.value = nextValue
      hasChanged = true
    }
  })
  if (hasChanged) renderDiceButtons()
}

function areRollingDiceSleeping() {
  return dice
    .filter((dieData) => !dieData.kept)
    .every((dieData) =>
      dieData.body.velocity.length() < 0.1 &&
      dieData.body.angularVelocity.length() < 0.1 &&
      hasDieReachedFaceRevealDelay(dieData) &&
      isDieSettledOnFace(dieData)
    )
}

function getDieFaceNormals(dieData) {
  return dieData.mesh.geometry.userData.faceNormals || []
}

function wakeUpBodyTiltAngle(dieData) {
  const body = dieData.body
  if (body.velocity.length() >= 0.08 || body.angularVelocity.length() >= 0.08) return

  body.wakeUp()
  // Keep this tilt wake-up: it helps dice leave edge/chamfer stalls and settle flat on a face.
  body.angularVelocity.set(
    body.angularVelocity.x + (Math.random() - 0.5) * 1.2,
    body.angularVelocity.y,
    body.angularVelocity.z + (Math.random() - 0.5) * 1.2
  )
}

function isDieSettledOnFace(dieData) {
  const faceNormals = getDieFaceNormals(dieData)
  if (faceNormals.length === 0) return true

  const down = new THREE.Vector3(0, -1, 0)
  let bestDot = -Infinity
  for (const entry of faceNormals) {
    const dot = entry.normal.clone().applyQuaternion(dieData.mesh.quaternion).dot(down)
    bestDot = Math.max(bestDot, dot)
  }

  if (bestDot >= FACE_SETTLE_DOT) return true

  wakeUpBodyTiltAngle(dieData)
  return false
}

function determineDieFaceValue(dieData) {
  const up = new THREE.Vector3(0, 1, 0)
  const faceNormals = getDieFaceNormals(dieData)
  if (faceNormals.length > 0) {
    let bestValue = 1
    let bestDot = -Infinity
    for (const entry of faceNormals) {
      const dot = entry.normal.clone().applyQuaternion(dieData.mesh.quaternion).dot(up)
      if (dot > bestDot) {
        bestDot = dot
        bestValue = entry.value
      }
    }
    return bestValue
  }
  const geometry = dieData.mesh.geometry
  const position = geometry.attributes.position
  const normals = []
  const normal = new THREE.Vector3()
  for (let i = 0; i < position.count; i += 1) {
    normal.fromBufferAttribute(position, i).normalize()
    normals.push(normal.clone().applyQuaternion(dieData.mesh.quaternion))
  }
  let bestValue = 1
  let bestDot = -Infinity
  for (let i = 0; i < Math.min(currentFaces, normals.length); i += 1) {
    const dot = normals[i].dot(up)
    if (dot > bestDot) {
      bestDot = dot
      bestValue = i + 1
    }
  }
  return bestValue
}

function finalizeRollingDice() {
  if (!rollInProgress) return
  if (!areRollingDiceSleeping()) return

  setTimeout(() => {
    dice.forEach((dieData) => {
      if (!dieData.kept && dieData.rolling) {
        dieData.value = determineDieFaceValue(dieData)
        dieData.rolling = false
      }
    })
    rollInProgress = false
    renderDiceButtons()
  }, 500)
}

function finalizeRound() {
  if (roundFinalized) return
  roundFinalized = true
  const bonus = getEarlyBonus(currentRoll)
  const total = scoreGain + bonus
  if (total > 0) {
    scoreCumule += total
    showScoreAnimation(`+${total}`, null, true)
    updateScoreDisplay()
  }
  scoreGain = 0
  if (scoreCumule >= SCORE_RESET_THRESHOLD) {
    scoreCumule = 0
    updateScoreDisplay()
  }
  roundBonusApplied = true
}

function getFloorPointFromPointer(event) {
  const rect = canvas.getBoundingClientRect()
  return getFloorPointFromScreen(event.clientX, event.clientY, rect)
}

function getFloorPointFromScreen(clientX, clientY, rect = canvas.getBoundingClientRect()) {
  pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointerNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1)
  raycaster.setFromCamera(pointerNdc, camera)
  const point = new THREE.Vector3()
  return raycaster.ray.intersectPlane(floorPickPlane, point) ? point : null
}

function getPinchPointers() {
  return [...activePointers.values()].slice(0, 2)
}

function getPinchMidpoint() {
  const [a, b] = getPinchPointers()
  if (!a || !b) return null
  return {
    x: (a.clientX + b.clientX) * 0.5,
    y: (a.clientY + b.clientY) * 0.5,
  }
}

function getPinchDistance() {
  const [a, b] = getPinchPointers()
  if (!a || !b) return 0
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function getCameraFrame() {
  const bounds = getVisibleDiceBounds()
  const maxPanOffset = Math.max(0.5, bounds.radius * CAMERA_PAN_MAX_FACTOR)
  const horizontalPanLength = Math.hypot(cameraPanOffset.x, cameraPanOffset.z)
  if (horizontalPanLength > maxPanOffset) {
    const factor = maxPanOffset / horizontalPanLength
    cameraPanOffset.x *= factor
    cameraPanOffset.z *= factor
  }
  const target = bounds.center.clone().add(cameraPanOffset)
  target.y += CAMERA_SCREEN_LOWER_TARGET_OFFSET
  const distance = Math.max(
    cameraOffset.length(),
    getCameraDistanceForRadius(bounds.radius)
  ) * cameraZoomScale
  const position = target.clone().add(
    cameraOffset.clone().normalize().multiplyScalar(distance)
  )
  return { target, position }
}

function applyCameraFrame(delta, snap = false) {
  if (!snap && (aimInProgress || pendingAimData)) return
  if (!snap && !pinchInProgress) {
    cameraPanOffset.lerp(new THREE.Vector3(0, 0, 0), 1 - Math.exp(-delta * 0.9))
  }
  const frame = getCameraFrame()
  const smoothing = snap ? 1 : 1 - Math.exp(-delta * 5.5)
  cameraTarget.lerp(frame.target, smoothing)
  camera.position.lerp(frame.position, smoothing)
  camera.lookAt(cameraTarget)
}

function beginPinchZoom() {
  if (aimInProgress) {
    aimInProgress = false
    activePointerId = null
    hideAimIndicator()
    releaseAimedDice()
  }
  pinchInProgress = true
  pinchStartDistance = getPinchDistance()
  pinchStartZoomScale = cameraZoomScale
}

function updatePinchZoom() {
  if (!pinchInProgress || activePointers.size < 2 || pinchStartDistance <= 0) return
  const midpoint = getPinchMidpoint()
  if (!midpoint) return

  const before = getFloorPointFromScreen(midpoint.x, midpoint.y)
  const nextDistance = getPinchDistance()
  cameraZoomScale = THREE.MathUtils.clamp(
    pinchStartZoomScale * (pinchStartDistance / Math.max(1, nextDistance)),
    0.25,
    5.0
  )
  applyCameraFrame(0, true)

  const after = getFloorPointFromScreen(midpoint.x, midpoint.y)
  if (before && after) {
    cameraPanOffset.add(before.sub(after))
    applyCameraFrame(0, true)
  }
}

function endPinchZoom() {
  if (activePointers.size < 2) {
    pinchInProgress = false
    pinchStartDistance = 0
  }
}

function getLaunchFromDrag(start, end) {
  const dragPointToOrigin = start.clone().sub(end)
  dragPointToOrigin.y = 0
  const distance = dragPointToOrigin.length()
  if (distance < 0.12) return null
  const forceRatio = Math.min(1, distance / MAX_DRAG_DISTANCE)
  return {
    direction: dragPointToOrigin.normalize(),
    forceRatio,
  }
}

function rollDice(launch) {
  if (pendingRoundReset) {
    pendingRoundReset = false
    createDice(Number(diceCountSelect.value))
    return
  }

  if (canFinishRound) {
    finalizeRound()
    canFinishRound = false
    pendingRoundReset = true
    return
  }

  if (currentRoll >= MAX_ROLLS) {
    canFinishRound = true
    updateRollUI()
    return
  }

  if (scoreGain > 0) {
    scoreCumule += scoreGain
    showScoreAnimation(`+${scoreGain}`, null)
    updateScoreDisplay()
    scoreGain = 0
  }

  const activeDice = getRollableDice()
  const fallbackLaunch = {
    direction: new THREE.Vector3(1, 0, 0),
    forceRatio: 0.55,
  }
  const throwLaunch = launch || fallbackLaunch
  releaseAimedDice()
  activeDice.forEach((dieData) => {
    dieData.value = null
    dieData.rolling = true
    dieData.floorContactAtSeconds = null
    applyDieImpulse(dieData, throwLaunch.direction, throwLaunch.forceRatio)
  })

  currentRoll += 1
  rollInProgress = true
  renderDiceButtons()
  updateRollUI()
  if (currentRoll >= MAX_ROLLS) {
    canFinishRound = true
  }
}

function updateAimIndicator(start, current) {
  const dx = current.x - start.x
  const dy = current.y - start.y
  const length = Math.min(160, Math.hypot(dx, dy))
  const angle = Math.atan2(dy, dx)
  aimIndicator.style.left = `${start.x}px`
  aimIndicator.style.top = `${start.y}px`
  aimIndicator.style.width = `${length}px`
  aimIndicator.style.transform = `rotate(${angle}rad)`
  aimIndicator.classList.toggle('visible', length > 8)
}

function hideAimIndicator() {
  aimIndicator.classList.remove('visible')
}

function releaseAimPointer(pointerId) {
  if (canvas.hasPointerCapture(pointerId)) {
    canvas.releasePointerCapture(pointerId)
  }
}

function clearPendingAim() {
  if (pendingAimTimer != null) {
    clearTimeout(pendingAimTimer)
  }
  pendingAimTimer = null
  pendingAimData = null
}

function startAimFromPointer(pointerData) {
  if (!activePointers.has(pointerData.pointerId)) return
  if (activePointers.size !== 1 || pinchInProgress) return
  if (rollInProgress || activePointerId != null) return
  if (pendingRoundReset || canFinishRound || currentRoll >= MAX_ROLLS) {
    rollDice()
    return
  }

  const floorPoint = getFloorPointFromScreen(pointerData.clientX, pointerData.clientY)
  if (!floorPoint) return

  activePointerId = pointerData.pointerId
  aimInProgress = true
  aimStartWorld = floorPoint.clone()
  aimCurrentWorld = floorPoint.clone()
  dragStartScreen.set(pointerData.clientX, pointerData.clientY)
  dragCurrentScreen.copy(dragStartScreen)
  beginHandAim(aimStartWorld)
  updateAimIndicator(dragStartScreen, dragCurrentScreen)
}

function beginAim(event) {
  activePointers.set(event.pointerId, {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
  })
  canvas.setPointerCapture(event.pointerId)

  if (activePointers.size >= 2) {
    clearPendingAim()
    beginPinchZoom()
    return
  }

  const pointerData = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
  }
  if (event.pointerType === 'touch') {
    clearPendingAim()
    pendingAimData = pointerData
    pendingAimTimer = setTimeout(() => {
      const data = pendingAimData
      clearPendingAim()
      if (data) startAimFromPointer(data)
    }, 140)
    return
  }

  startAimFromPointer(pointerData)
}

function updateAim(event) {
  if (activePointers.has(event.pointerId)) {
    activePointers.set(event.pointerId, {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    })
  }
  if (pendingAimData?.pointerId === event.pointerId) {
    pendingAimData = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    }
  }
  if (pinchInProgress) {
    updatePinchZoom()
    return
  }

  if (!aimInProgress || event.pointerId !== activePointerId) return
  const floorPoint = getFloorPointFromPointer(event)
  if (floorPoint) aimCurrentWorld = floorPoint.clone()
  moveHandAim(aimCurrentWorld)
  dragCurrentScreen.set(event.clientX, event.clientY)
  updateAimIndicator(dragStartScreen, dragCurrentScreen)
}

function finishAim(event) {
  if (pinchInProgress) {
    activePointers.delete(event.pointerId)
    releaseAimPointer(event.pointerId)
    endPinchZoom()
    return
  }

  if (pendingAimData?.pointerId === event.pointerId) {
    clearPendingAim()
  }
  activePointers.delete(event.pointerId)
  releaseAimPointer(event.pointerId)
  if (!aimInProgress || event.pointerId !== activePointerId) return
  const floorPoint = getFloorPointFromPointer(event)
  if (floorPoint) aimCurrentWorld = floorPoint.clone()
  moveHandAim(aimCurrentWorld)
  const launch = getLaunchFromDrag(aimStartWorld, aimCurrentWorld)
  aimInProgress = false
  activePointerId = null
  hideAimIndicator()
  if (launch) {
    rollDice(launch)
  } else {
    releaseAimedDice()
  }
}

function cancelAim(event) {
  if (pendingAimData?.pointerId === event.pointerId) {
    clearPendingAim()
  }
  activePointers.delete(event.pointerId)
  if (pinchInProgress) {
    releaseAimPointer(event.pointerId)
    endPinchZoom()
    return
  }

  if (!aimInProgress || event.pointerId !== activePointerId) return
  aimInProgress = false
  activePointerId = null
  hideAimIndicator()
  releaseAimPointer(event.pointerId)
  releaseAimedDice()
}

diceCountSelect.addEventListener('change', (event) => {
  createDice(Number(event.target.value))
  closeMenu()
})

diceFacesSelect.addEventListener('change', (event) => {
  currentFaces = Number(event.target.value)
  createDice(Number(diceCountSelect.value))
  closeMenu()
})

frictionSlider.addEventListener('input', (event) => {
  setGroundFriction(Number(event.target.value))
})

diceFrictionSlider.addEventListener('input', (event) => {
  setDiceFriction(Number(event.target.value))
})

massSlider.addEventListener('input', (event) => {
  setDieMass(Number(event.target.value))
})

throwForceSlider.addEventListener('input', (event) => {
  setThrowForce(Number(event.target.value))
})

throwAngleSlider.addEventListener('input', (event) => {
  setThrowAltitudeAngle(Number(event.target.value))
})

canvas.addEventListener('pointerdown', beginAim)
canvas.addEventListener('pointermove', updateAim)
canvas.addEventListener('pointerup', finishAim)
canvas.addEventListener('pointercancel', cancelAim)
menuButton.addEventListener('click', toggleMenu)
tuningButton.addEventListener('click', toggleTuningMenu)
languageToggle.addEventListener('click', toggleLanguage)
resetButton.addEventListener('click', () => createDice(Number(diceCountSelect.value)))

function animate() {
  requestAnimationFrame(animate)

  const delta = clock.getDelta()
  elapsedGameSeconds += delta
  if (aimInProgress && aimCurrentWorld) {
    moveHandAim(aimCurrentWorld)
    containAimedDiceInHandSphere()
  }
  world.step(timeStep, delta, 3)
  containAimedDiceInHandSphere()
  updateDiceFloorContactTimes()
  syncPhysics()
  updateRealtimeDieFaceValues()
  finalizeRollingDice()
  updateCameraFrame(delta)

  renderer.render(scene, camera)
}

function updateCameraFrame(delta) {
  applyCameraFrame(delta)
}

function getVisibleDiceBounds() {
  const visibleDice = dice.filter(dieData => !dieData.kept && dieData.mesh.visible)
  if (visibleDice.length === 0) {
    return {
      center: new THREE.Vector3(0, FLOOR_Y + 0.5, 0),
      radius: CAMERA_FALLBACK_RADIUS,
    }
  }

  const box = new THREE.Box3()
  for (const dieData of visibleDice) {
    dieData.mesh.updateWorldMatrix(true, false)
    box.expandByObject(dieData.mesh)
  }

  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const radius = Math.max(CAMERA_FALLBACK_RADIUS, size.length() * 0.5 + 0.45)
  center.y = Math.max(center.y, FLOOR_Y + 0.45)

  return { center, radius }
}

function getCameraDistanceForRadius(radius) {
  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect)
  const limitingFov = Math.min(verticalFov, horizontalFov)
  return Math.max(6, (radius * CAMERA_MARGIN) / Math.sin(limitingFov / 2))
}

applyLocalization()
createDice(Number(diceCountSelect.value))
animate()

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
