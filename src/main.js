import './style.css'
import * as THREE from 'three'
import * as CANNON from 'cannon-es'

const app = document.querySelector('#app')
app.innerHTML = `
  <div id="ui">
    <button id="menu-button" type="button" aria-label="Menu">
      <span></span>
      <span></span>
      <span></span>
    </button>
    <div id="menu-panel" class="closed">
      <div class="control-row">
        <label for="dice-count">Nombre de dés</label>
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
        <label for="dice-faces">Nombre de faces</label>
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
    <div id="roll-panel">
      <div id="roll-header">Lancer 1 / 3</div>
      <div id="score-display">Score: 0</div>
      <div id="dice-buttons" class="dice-buttons"></div>
      <div id="roll-controls">
        <button id="reset-button" type="button" class="secondary">Réinitialiser</button>
      </div>
    </div>
    <div id="score-animations"></div>
  </div>
  <canvas id="bg"></canvas>
`

const canvas = document.querySelector('#bg')
const diceCountSelect = document.querySelector('#dice-count')
const diceFacesSelect = document.querySelector('#dice-faces')
const menuButton = document.querySelector('#menu-button')
const menuPanel = document.querySelector('#menu-panel')
const rollHeader = document.querySelector('#roll-header')
const diceButtonsContainer = document.querySelector('#dice-buttons')
const resetButton = document.querySelector('#reset-button')
const scoreDisplay = document.querySelector('#score-display')
const scoreAnimations = document.querySelector('#score-animations')
resetButton.style.display = 'none'

const scene = new THREE.Scene()

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)
camera.position.set(0, 4, 8)
camera.lookAt(0, 0, 0)

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

const floorGeometry = new THREE.PlaneGeometry(20, 20)
const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x2c2c3e,
  roughness: 0.9,
  metalness: 0.1,
})
const floor = new THREE.Mesh(floorGeometry, floorMaterial)
floor.rotation.x = -Math.PI / 2
floor.position.y = -1.5
scene.add(floor)

const world = new CANNON.World()
world.gravity.set(0, -15, 0)
world.allowSleep = true

const diceMaterial = new CANNON.Material('dice')
const floorMaterialBody = new CANNON.Material('floor')
const contactMaterial = new CANNON.ContactMaterial(diceMaterial, floorMaterialBody, {
  friction: 0.25,
  restitution: 0.4,
})
world.defaultContactMaterial = contactMaterial

const floorBody = new CANNON.Body({
  mass: 0,
  shape: new CANNON.Box(new CANNON.Vec3(10, 0.1, 10)),
  position: new CANNON.Vec3(0, -1.5, 0),
  material: floorMaterialBody,
})
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
const boundaryRadius = 4.5
let cameraZoomTimer = 0

let dice = []
let rollInProgress = false
let currentFaces = Number(diceFacesSelect.value)
let currentRoll = 0
const maxRolls = 3
let scoreCumule = 0
let scoreGain = 0
let canFinishRound = false

function getKeepableDice() {
  const values = dice.map(d => d.value).filter(v => v != null)
  const countMap = {}
  values.forEach(v => countMap[v] = (countMap[v] || 0) + 1)
  const keepable = new Set()

  // Max value
  const maxVal = Math.max(...values)
  dice.forEach((d, i) => { if (d.value === maxVal) keepable.add(i) })

  // Doubles: one from each pair
  Object.entries(countMap).forEach(([val, count]) => {
    if (count >= 2) {
      const indices = dice.map((d, i) => d.value === Number(val) ? i : -1).filter(i => i !== -1)
      keepable.add(indices[0]) // keep one
    }
  })

  // Sum 10 pairs: for dice 6, 4+6, 3+7 but since max 6, 4+6
  const pairs = []
  for (let i = 0; i < dice.length; i++) {
    for (let j = i+1; j < dice.length; j++) {
      if (dice[i].value + dice[j].value === 10) {
        pairs.push([i, j])
      }
    }
  }
  pairs.forEach(([i, j]) => { keepable.add(i) }) // keep one from each pair

  // Brelan: all three
  Object.entries(countMap).forEach(([val, count]) => {
    if (count >= 3) {
      dice.forEach((d, i) => { if (d.value === Number(val)) keepable.add(i) })
    }
  })

  // Suite: one from three consecutive
  const sorted = [...new Set(values)].sort((a,b)=>a-b)
  for (let i = 0; i < sorted.length - 2; i++) {
    if (sorted[i+1] === sorted[i]+1 && sorted[i+2] === sorted[i]+2) {
      const indices = dice.map((d, idx) => d.value === sorted[i] || d.value === sorted[i+1] || d.value === sorted[i+2] ? idx : -1).filter(idx => idx !== -1)
      keepable.add(indices[0]) // keep one
    }
  }

  return keepable
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
  return `Lancer ${Math.min(currentRoll + 1, maxRolls)} / ${maxRolls}`
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
  scoreDisplay.textContent = `Score: ${scoreCumule}`
}

function toggleMenu() {
  menuPanel.classList.toggle('open')
}

function closeMenu() {
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
    if (!keepable.has(index) && !dieData.kept) {
      button.classList.add('disabled')
    }

    button.addEventListener('click', () => {
      if (currentRoll === 0 || (currentRoll >= maxRolls && !canFinishRound) || dieData.rolling || (!keepable.has(index) && !dieData.kept)) return
      dieData.kept = !dieData.kept
      button.classList.toggle('kept', dieData.kept)
      dieData.mesh.visible = !dieData.kept
      if (dieData.kept) {
        dieData.body.type = CANNON.Body.STATIC
        // Animation and score
        showScoreAnimation('+1', dieData)
        scoreGain += 1
      } else {
        dieData.body.type = CANNON.Body.DYNAMIC
        dieData.body.wakeUp()
        scoreGain -= 1
      }
      renderDiceButtons()
    })

    diceButtonsContainer.appendChild(button)
  })
}

function createDieGeometry(faceCount) {
  switch (faceCount) {
    case 4:
      return new THREE.TetrahedronGeometry(1)
    case 6:
      return new THREE.BoxGeometry(1, 1, 1)
    case 8:
      return new THREE.OctahedronGeometry(1)
    case 10:
      return createD10Geometry()
    case 12:
      return new THREE.DodecahedronGeometry(1)
    case 20:
      return new THREE.IcosahedronGeometry(1)
    default:
      return new THREE.BoxGeometry(1, 1, 1)
  }
}

function createD10Geometry() {
  const radius = 1
  const midZ = 0.3
  const topZ = 1.1
  const vertices = []
  const indices = []

  vertices.push(0, 0, topZ)
  vertices.push(0, 0, -topZ)

  const ringCount = 5
  for (let i = 0; i < ringCount; i += 1) {
    const angle = (i * Math.PI * 2) / ringCount
    vertices.push(
      radius * Math.cos(angle),
      radius * Math.sin(angle),
      midZ
    )
  }
  for (let i = 0; i < ringCount; i += 1) {
    const angle = (i * Math.PI * 2) / ringCount + Math.PI / ringCount
    vertices.push(
      radius * Math.cos(angle),
      radius * Math.sin(angle),
      -midZ
    )
  }

  for (let i = 0; i < ringCount; i += 1) {
    const next = (i + 1) % ringCount
    const topIndex = 0
    const bottomIndex = 1
    const upperA = 2 + i
    const upperB = 2 + next
    const lowerA = 2 + ringCount + i
    const lowerB = 2 + ringCount + next

    indices.push(topIndex, upperA, lowerA)
    indices.push(topIndex, lowerA, upperB)
    indices.push(bottomIndex, lowerA, upperA)
    indices.push(bottomIndex, upperB, lowerA)
  }

  return new THREE.PolyhedronGeometry(vertices, indices, 1, 0)
}

function createDie(x, z, index) {
  const geometry = createDieGeometry(currentFaces)
  const color = getDieColor(index)
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.15,
  })
  const die = new THREE.Mesh(geometry, material)
  die.position.set(x, 0.5, z)
  scene.add(die)

  const shape = createPhysicsShape(geometry, currentFaces)
  const body = new CANNON.Body({
    mass: 3,
    shape,
    position: new CANNON.Vec3(x, 0.5, z),
    linearDamping: 0.05,
    angularDamping: 0.05,
    material: diceMaterial,
  })
  body.allowSleep = true
  body.sleepSpeedLimit = 0.05
  body.sleepTimeLimit = 0.5
  world.addBody(body)

  return {
    mesh: die,
    body,
    color,
    value: null,
    rolling: false,
    kept: false,
    index,
  }
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
    const position = geometry.attributes.position
    const index = geometry.index
    const vertices = []
    for (let i = 0; i < position.count; i++) {
      vertices.push(new CANNON.Vec3(
        position.getX(i),
        position.getY(i),
        position.getZ(i)
      ))
    }
    const faces = []
    for (let i = 0; i < index.count; i += 3) {
      faces.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)])
    }
    return new CANNON.ConvexPolyhedron({ vertices, faces })
  }
}

function createDice(count) {
  clearDice()
  currentRoll = 0
  rollInProgress = false
  canFinishRound = false
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

function resetDiePhysics(dieData) {
  const body = dieData.body
  body.velocity.set(0, 0, 0)
  body.angularVelocity.set(0, 0, 0)
  body.position.set(body.position.x, 1.5, body.position.z)
  body.quaternion.set(0, 0, 0, 1)
  body.wakeUp()
}

function applyDieImpulse(body) {
  const impulse = new CANNON.Vec3(
    (Math.random() - 0.5) * 2,
    8 + Math.random() * 4,
    (Math.random() - 0.5) * 2
  )
  body.applyImpulse(impulse, new CANNON.Vec3(0, 0, 0))
  body.angularVelocity.set(
    (Math.random() - 0.5) * 8,
    (Math.random() - 0.5) * 8,
    (Math.random() - 0.5) * 8
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

function areRollingDiceSleeping() {
  return dice
    .filter((dieData) => !dieData.kept)
    .every((dieData) =>
      dieData.body.velocity.length() < 0.1 &&
      dieData.body.angularVelocity.length() < 0.1
    )
}

function determineDieFaceValue(dieData) {
  const geometry = dieData.mesh.geometry
  const position = geometry.attributes.position
  const index = geometry.index
  let bestDot = -Infinity
  let bestFace = 0
  const up = new THREE.Vector3(0, 1, 0)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const faceNormal = new THREE.Vector3()
  const worldNormal = new THREE.Vector3()
  const trianglesPerFace = Math.max(1, index.count / 3 / currentFaces)

  for (let face = 0; face < index.count; face += 3) {
    a.fromBufferAttribute(position, index.getX(face))
    b.fromBufferAttribute(position, index.getX(face + 1))
    c.fromBufferAttribute(position, index.getX(face + 2))
    faceNormal.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
    worldNormal.copy(faceNormal).applyQuaternion(dieData.mesh.quaternion)
    const dot = worldNormal.dot(up)
    if (dot > bestDot) {
      bestDot = dot
      bestFace = Math.floor(face / 3 / trianglesPerFace)
    }
  }

  return Math.min(currentFaces, Math.max(1, bestFace + 1))
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

    // Check for all kept at 3rd roll
    if (currentRoll >= maxRolls && dice.every(d => d.kept)) {
      scoreCumule += 10
      showScoreAnimation('+10', null)
      updateScoreDisplay()
    }
  }, 500)
}

function clampDieBounds(dieData) {
  const x = dieData.body.position.x
  const z = dieData.body.position.z
  const distance = Math.sqrt(x * x + z * z)
  if (distance > boundaryRadius) {
    const factor = boundaryRadius / distance
    dieData.body.position.x *= factor
    dieData.body.position.z *= factor
    dieData.body.velocity.x *= 0.5
    dieData.body.velocity.z *= 0.5
  }
}

function rollDice() {
  // After 3rd roll, clicking canvas finishes the round
  if (canFinishRound) {
    // Final score
    if (scoreGain > 0) {
      scoreCumule += scoreGain
      showScoreAnimation(`+${scoreGain}!`, null, true)
      scoreGain = 0
      updateScoreDisplay()
    }
    // Reset global score if >= 50
    if (scoreCumule >= 50) {
      scoreCumule = 0
      updateScoreDisplay()
    }
    canFinishRound = false
    createDice(Number(diceCountSelect.value))
    return
  }

  if (currentRoll >= maxRolls) {
    // After 3rd roll, allow to keep more dice then finish
    canFinishRound = true
    return
  }

  // Cumulate score
  if (scoreGain > 0) {
    scoreCumule += scoreGain
    showScoreAnimation(`+${scoreGain}`, null)
    updateScoreDisplay()
    scoreGain = 0
  }

  for (const dieData of dice) {
    if (!dieData.kept || currentRoll === 0) {
      dieData.value = null
      dieData.rolling = true
      resetDiePhysics(dieData)
      applyDieImpulse(dieData.body)
    }
  }

  currentRoll += 1
  rollInProgress = true
  cameraZoomTimer = 0
  renderDiceButtons()
  updateRollUI()
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

canvas.addEventListener('click', rollDice)
menuButton.addEventListener('click', toggleMenu)
resetButton.addEventListener('click', () => createDice(Number(diceCountSelect.value)))

function animate() {
  requestAnimationFrame(animate)

  const delta = clock.getDelta()
  world.step(timeStep, delta, 3)
  dice.forEach(clampDieBounds)
  syncPhysics()
  finalizeRollingDice()
  animateCameraZoom(delta)

  renderer.render(scene, camera)
}

function animateCameraZoom(delta) {
  if (cameraZoomTimer >= 0.4) {
    camera.position.set(0, 4, 8)
    camera.lookAt(0, 0, 0)
    return
  }

  cameraZoomTimer += delta
  const t = Math.min(1, cameraZoomTimer / 0.4)
  const pulse = Math.sin(t * Math.PI)
  camera.position.set(0, 4 + pulse * 0.4, 8 + pulse * 0.8)
  camera.lookAt(0, 0, 0)
}

createDice(Number(diceCountSelect.value))
animate()

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})