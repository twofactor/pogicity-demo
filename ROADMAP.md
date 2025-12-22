# Pogicity Roadmap

A rough plan for evolving Pogicity into a full city simulation game, inspired by SimCity 3000/4.

---

## Phase 1: Core Assets & Lots (Current)

### Building Assets
- [x] Residential buildings (various sizes)
- [x] Commercial buildings
- [x] Landmarks
- [x] Props (trees, statues, fountains, benches)
- [ ] Industrial buildings
- [ ] Civic buildings (police, fire, hospital, schools)
- [ ] Parks & recreation
- [ ] Utilities (power plants, water towers)

### Lot System
- [ ] **Lot definitions** - Combine props + buildings into placeable lots
  - Front yard props, fencing, parking, landscaping
  - Lot "styles" (suburban, urban, historic, modern)
- [ ] **Lot growth** - Empty zoned lots develop over time based on demand
- [ ] **Lot upgrading** - Buildings can upgrade/densify when conditions are met
- [ ] **Lot abandonment** - Buildings decay when conditions deteriorate

### Additional Props
- [ ] Fences (will need special depth sorting - see MainScene.ts comments)
- [ ] Traffic lights (overhang depth anchoring - see MainScene.ts comments)
- [ ] Street lamps (different styles)
- [ ] Parking lots & garages
- [ ] Bus stops, transit stations

---

## Phase 2: Zoning & Simulation Core

### Zoning System (SC3K/SC4 style)
- [ ] **Zone types**: Residential (R), Commercial (C), Industrial (I)
- [ ] **Density levels**: Low, Medium, High
- [ ] **Zone painting** - Drag to zone areas along roads
- [ ] **De-zoning** - Remove zones to stop development
- [ ] **Zone demand** - R/C/I demand bars based on city conditions

### RCI Simulation
- [ ] **Population** - Residents live in R zones, need jobs & shops
- [ ] **Jobs** - C and I zones provide employment
- [ ] **Commerce** - C zones need customers (residents)
- [ ] **Industry** - I zones produce goods, create pollution
- [ ] **Demand calculation**:
  ```
  R demand = f(jobs available, desirability, land value)
  C demand = f(population, traffic access, wealth)
  I demand = f(labor pool, freight access, tax rates)
  ```

### Land Value & Desirability
- [ ] **Land value map** - Affects what develops where
- [ ] **Desirability factors**:
  - (+) Parks, landmarks, water, low crime, good schools
  - (-) Pollution, crime, traffic, industrial proximity
- [ ] **Wealth levels** - $, $$, $$$ residents/businesses
- [ ] **NIMBY effects** - Some buildings lower nearby values

---

## Phase 3: City Services & Budget

### Service Buildings
- [ ] **Police** - Coverage radius, reduces crime
- [ ] **Fire** - Coverage radius, reduces fire risk
- [ ] **Health** - Hospitals, clinics - affects life expectancy
- [ ] **Education** - Schools, colleges - affects workforce quality
- [ ] **Utilities**:
  - Power grid (power plants, lines, coverage)
  - Water system (pumps, pipes, towers)
  - Garbage (landfills, recycling, incinerators)

### Budget System
- [ ] **Income**:
  - Property taxes (R/C/I separate rates)
  - Business deals & ordinances
  - Neighbor deals (sell utilities)
- [ ] **Expenses**:
  - Service funding (police, fire, health, education)
  - Transportation maintenance
  - Loan repayments
- [ ] **Monthly/yearly budget cycle**
- [ ] **Debt & loans** - Borrow money with interest

### Advisors (SC3K style)
- [ ] **Finance Advisor** - Budget recommendations
- [ ] **City Planner** - Zoning & development advice
- [ ] **Transportation Advisor** - Traffic & transit
- [ ] **Utilities Advisor** - Power/water coverage
- [ ] **Safety Advisor** - Police/fire coverage
- [ ] **Health/Education Advisor** - Service coverage
- [ ] Each advisor has personality & portrait

---

## Phase 4: Transportation & Traffic

### Road Types
- [ ] **Streets** - Low capacity, local traffic
- [ ] **Avenues** - Medium capacity, 4 lanes
- [ ] **Highways** - High capacity, limited access
- [ ] **One-way roads** - Traffic flow control
- [ ] **Intersections** - Stop signs, traffic lights

### Public Transit
- [ ] **Bus system** - Bus stops, routes, depots
- [ ] **Rail** - Subway, elevated rail, stations
- [ ] **Commuter rail** - Regional connections

### Traffic Simulation
- [ ] **Pathfinding** - A* from origin to destination
- [ ] **Traffic density** - Track vehicles per road segment
- [ ] **Congestion effects** - Slows travel, lowers desirability
- [ ] **Commute patterns** - R->C/I in morning, reverse in evening

### NPC Simulation (Quasi-random)
- [ ] **Generalized patterns** instead of true agent simulation:
  ```
  Morning: Spawn from R zones, path toward C/I zones
  Midday: Random movement in commercial areas
  Evening: Return paths toward R zones
  Weekend: Parks, landmarks, shopping areas
  ```
- [ ] **Traffic weighting** - NPCs prefer main roads
- [ ] **Destination attractors** - Landmarks, shops, parks draw NPCs
- [ ] Keep some random wanderers for charm!

### Implementation Hacks: Simplifying Transit & Traffic

Traffic simulation is notoriously complex (see: Cities Skylines death waves, SC2013 garbage trucks). Here's how to fake it convincingly without true agent simulation.

#### Hack #1: Traffic as a Heat Map, Not Agents

**The Problem:** True traffic sim = every car has origin/destination/path = expensive + cascading failures.

**The Hack:** Traffic is just numbers on road segments.

```typescript
// Each road tile has a "usage" value
interface RoadTile {
  capacity: number;      // Streets: 100, Avenues: 300, Highways: 1000
  usage: number;         // Current "cars" on this segment
  congestion: number;    // usage / capacity (0-1+)
}

// Every sim tick, recompute usage based on ZONES, not agents
function computeTrafficUsage(grid: Grid): void {
  // Reset all roads
  for (const road of getAllRoads(grid)) {
    road.usage = 0;
  }

  // For each R tile, add "commuters" to nearby roads
  for (const residential of getZones(grid, 'R')) {
    const population = residential.population;
    const nearbyRoads = getRoadsInRadius(residential, 5);

    // Distribute commuter "weight" to roads leading toward C/I zones
    for (const road of nearbyRoads) {
      const distToWork = distanceToNearestZone(road, ['C', 'I']);
      road.usage += population * (1 / distToWork);
    }
  }

  // Compute congestion
  for (const road of getAllRoads(grid)) {
    road.congestion = road.usage / road.capacity;
  }
}
```

**Visual Cars:** Spawn car sprites based on `road.usage`, not actual simulation.
```typescript
// More cars spawn on high-usage roads
const carsToSpawn = Math.floor(road.usage / 20);
```

#### Hack #2: "Flow Lanes" Instead of Pathfinding

**The Problem:** A* pathfinding for every car = CPU explosion.

**The Hack:** Pre-compute "flow lanes" - roads know which direction leads where.

```typescript
// Pre-computed once when roads change
interface RoadFlowData {
  toCommercial: Direction;  // "go this way to reach C zones"
  toIndustrial: Direction;
  toResidential: Direction;
  toHighway: Direction | null;
}

// Cars just follow the flow
function updateCar(car: Car, road: RoadTile): void {
  const hour = gameTime.hour;

  if (hour >= 7 && hour <= 9) {
    // Morning: follow flow toward work
    car.direction = road.flow.toCommercial;
  } else if (hour >= 17 && hour <= 19) {
    // Evening: follow flow toward home
    car.direction = road.flow.toResidential;
  } else {
    // Random movement
    car.direction = randomRoadDirection(road);
  }
}
```

**No A*!** Cars are like water - they flow along pre-computed gradients.

#### Hack #3: Transit as Coverage Zones

**The Problem:** Bus routes, train schedules, passenger counts = complex.

**The Hack:** Transit = coverage radius, like police/fire.

```typescript
interface TransitStop {
  type: 'bus' | 'rail' | 'subway';
  position: { x: number; y: number };
  coverageRadius: number;  // Bus: 5 tiles, Rail: 10 tiles
  capacity: number;        // Affects effectiveness
}

// Transit coverage reduces "effective distance" for commuters
function getEffectiveCommuteDistance(
  home: Position,
  work: Position,
  transitStops: TransitStop[]
): number {
  const realDistance = manhattanDistance(home, work);

  // Check if both ends are near transit
  const homeTransit = findNearestTransit(home, transitStops);
  const workTransit = findNearestTransit(work, transitStops);

  if (homeTransit && workTransit && homeTransit.type === workTransit.type) {
    // Transit cuts effective distance significantly
    return realDistance * 0.3;
  } else if (homeTransit || workTransit) {
    // Partial transit coverage
    return realDistance * 0.6;
  }

  return realDistance;  // Car-only commute
}
```

**Visual Trains/Buses:** Just animate along tracks/routes. They don't affect simulation.

#### Hack #4: The "Nearby Roads" Approximation

**The Problem:** Finding optimal path through road network is expensive.

**The Hack:** Just check if tiles are "connected" via flood fill, done once.

```typescript
// Computed once when roads change
interface ConnectivityMap {
  // Each zone knows which "road network" it's connected to
  networkId: number;
}

// Two tiles can commute if same network ID
function canCommute(home: Position, work: Position): boolean {
  return connectivityMap[home.y][home.x].networkId ===
         connectivityMap[work.y][work.x].networkId;
}

// Congestion penalty is just average of roads in area, not actual path
function getCommutePenalty(home: Position, work: Position): number {
  const roadsBetween = getRoadsInRect(home, work);
  const avgCongestion = average(roadsBetween.map(r => r.congestion));
  return avgCongestion;  // 0 = free flow, 1+ = gridlock
}
```

#### Hack #5: Visual Density Matching

**The Problem:** Need to show "traffic" visually without simulating it.

**The Hack:** Car spawn rate = road usage. That's it.

```typescript
// In Phaser, every few seconds:
function spawnTrafficVisualization(): void {
  for (const road of visibleRoads) {
    // More congested = more cars visible
    const targetCars = Math.floor(road.congestion * 5);
    const currentCars = getCarsOnRoad(road);

    if (currentCars < targetCars) {
      spawnCar(road, randomDirectionFromFlow(road));
    }
  }
}

// Cars just drive until off-screen, then despawn
// No pathfinding, no destinations, just vibes
```

#### Hack #6: Rush Hour is Just a Multiplier

```typescript
function getTimeOfDayMultiplier(hour: number): number {
  if (hour >= 7 && hour <= 9) return 2.0;   // Morning rush
  if (hour >= 17 && hour <= 19) return 2.0; // Evening rush
  if (hour >= 22 || hour <= 5) return 0.3;  // Night
  return 1.0;  // Normal
}

// Apply to all road usage calculations
road.usage *= getTimeOfDayMultiplier(gameTime.hour);
```

#### Hack #7: Transit Vehicles as Decoration

Buses and trains don't carry passengers. They're just moving sprites.

```typescript
// Bus follows a fixed route (list of road tiles)
interface BusRoute {
  stops: Position[];
  currentIndex: number;
}

function updateBus(bus: Bus, route: BusRoute): void {
  // Move toward next stop
  const target = route.stops[route.currentIndex];
  moveToward(bus, target);

  if (atPosition(bus, target)) {
    // "Stop" animation for a second
    bus.state = 'stopped';
    setTimeout(() => {
      bus.state = 'moving';
      route.currentIndex = (route.currentIndex + 1) % route.stops.length;
    }, 1000);
  }
}

// The bus existing near a zone = transit coverage
// No actual passengers simulated
```

#### Hack #8: NPCs "Riding" Transit (The Teleport Trick)

**The Problem:** How do NPCs get on a bus, ride it, and get off?

**The Hack:** They don't. They teleport. But it *looks* like they rode.

```typescript
// NPC decides to use transit
function handleNPCTransit(npc: NPC, destination: Position): void {
  const nearestStop = findNearestTransitStop(npc.position);
  const destinationStop = findNearestTransitStop(destination);

  if (!nearestStop || !destinationStop) {
    // No transit available, walk normally
    npc.pathTo(destination);
    return;
  }

  // Phase 1: Walk to the stop
  npc.pathTo(nearestStop.position);
  npc.onArrival = () => {
    // Phase 2: "Wait" at stop (stand there, maybe play waiting anim)
    npc.state = 'waiting_for_transit';
    npc.waitingAt = nearestStop;
  };
}

// When a bus/train arrives at a stop
function onTransitArrivesAtStop(transit: Transit, stop: TransitStop): void {
  // Find NPCs waiting at this stop
  const waitingNPCs = getNPCsWaitingAt(stop);

  for (const npc of waitingNPCs) {
    // Make NPC invisible (they're "on" the vehicle)
    npc.visible = false;
    npc.state = 'riding_transit';
    npc.ridingVehicle = transit;
  }
}

// When transit arrives at a stop, check if riders want to get off
function onTransitDepartsStop(transit: Transit, stop: TransitStop): void {
  const riders = getNPCsRiding(transit);

  for (const npc of riders) {
    const destStop = findNearestTransitStop(npc.finalDestination);

    // Is this their stop?
    if (destStop && distanceBetween(stop, destStop) < 2) {
      // "Get off" - reappear at stop
      npc.visible = true;
      npc.position = stop.position;
      npc.state = 'walking';
      npc.ridingVehicle = null;

      // Continue walking to final destination
      npc.pathTo(npc.finalDestination);
    }
    // Otherwise, stay on (remain invisible, keep riding)
  }
}
```

**What the player sees:**
1. NPC walks to bus stop, stands there
2. Bus arrives, NPC disappears
3. Bus drives to another stop
4. NPC reappears at that stop, walks away

**What's actually happening:**
- NPC is just invisible while "riding"
- No seat tracking, no passenger count, no boarding logic
- NPC teleports between stops, timed to match vehicle arrival

#### Hack #9: Transit Network as a Graph

For NPCs to know "take bus to station X, then rail to station Y":

```typescript
// Pre-computed transit graph
interface TransitNetwork {
  stops: TransitStop[];
  connections: TransitConnection[];
}

interface TransitConnection {
  from: TransitStop;
  to: TransitStop;
  type: 'bus' | 'rail' | 'subway';
  travelTime: number;  // Simulated time between stops
}

// Find path through transit network
function findTransitPath(
  origin: Position,
  destination: Position,
  network: TransitNetwork
): TransitPath | null {
  const originStop = findNearestStop(origin, network);
  const destStop = findNearestStop(destination, network);

  if (!originStop || !destStop) return null;

  // Simple BFS through transit connections
  // Much simpler than road pathfinding - just nodes and edges
  return bfsPath(originStop, destStop, network.connections);
}

interface TransitPath {
  legs: TransitLeg[];
}

interface TransitLeg {
  boardAt: TransitStop;
  alightAt: TransitStop;
  type: 'bus' | 'rail' | 'subway';
}

// NPC executes the path
function executeTransitPath(npc: NPC, path: TransitPath): void {
  const firstLeg = path.legs[0];

  // Walk to first boarding point
  npc.pathTo(firstLeg.boardAt.position);
  npc.transitPlan = path;
  npc.currentLegIndex = 0;
}
```

**Multi-modal trips:**
```
NPC wants to go from residential area to downtown

Transit path found:
  1. Walk to Bus Stop A (0.5 tiles away)
  2. Ride Bus Line 1 → Bus Stop B (3 stops)
  3. Walk to Rail Station (0.2 tiles away)
  4. Ride Rail Line → Central Station (2 stops)
  5. Walk to final destination (0.8 tiles away)

NPC executes this as a state machine, becoming invisible
during "ride" segments.
```

#### Hack #10: Vehicles Know Their Routes

```typescript
interface TransitVehicle {
  id: string;
  type: 'bus' | 'train';
  route: TransitRoute;
  currentStopIndex: number;
  position: Position;
  passengers: NPC[];  // Just references, not simulated
}

interface TransitRoute {
  id: string;
  name: string;       // "Line 1", "Blue Line"
  stops: TransitStop[];
  isLoop: boolean;    // Does it loop or ping-pong?
}

// Update vehicle each frame
function updateTransitVehicle(vehicle: TransitVehicle, delta: number): void {
  const currentStop = vehicle.route.stops[vehicle.currentStopIndex];
  const nextStop = getNextStop(vehicle);

  if (atPosition(vehicle.position, currentStop.position)) {
    // At a stop
    if (vehicle.dwellTime > 0) {
      // Still dwelling, let passengers on/off
      vehicle.dwellTime -= delta;
      handlePassengerExchange(vehicle, currentStop);
    } else {
      // Done dwelling, move to next stop
      vehicle.currentStopIndex = getNextStopIndex(vehicle);
      vehicle.dwellTime = DWELL_TIME;
    }
  } else {
    // In transit between stops
    moveToward(vehicle.position, nextStop.position, TRANSIT_SPEED * delta);
  }
}

function getNextStop(vehicle: TransitVehicle): TransitStop {
  const route = vehicle.route;
  let nextIndex = vehicle.currentStopIndex + vehicle.direction;

  if (route.isLoop) {
    // Loop around
    nextIndex = nextIndex % route.stops.length;
  } else {
    // Ping-pong at ends
    if (nextIndex >= route.stops.length || nextIndex < 0) {
      vehicle.direction *= -1;
      nextIndex = vehicle.currentStopIndex + vehicle.direction;
    }
  }

  return route.stops[nextIndex];
}
```

#### Visual Polish: The Illusion of Boarding

```typescript
// When NPC "boards", play a quick animation
function boardTransit(npc: NPC, vehicle: TransitVehicle, stop: TransitStop): void {
  // Walk to vehicle door position
  const doorPos = getVehicleDoorPosition(vehicle);
  npc.walkTo(doorPos);

  // Quick "step up" animation
  npc.playAnimation('board_vehicle');

  // After animation, hide NPC
  setTimeout(() => {
    npc.visible = false;
    npc.state = 'riding';
    vehicle.passengers.push(npc);
  }, 300);
}

// When NPC "alights"
function alightTransit(npc: NPC, vehicle: TransitVehicle, stop: TransitStop): void {
  // Position at door
  const doorPos = getVehicleDoorPosition(vehicle);
  npc.position = doorPos;
  npc.visible = true;

  // "Step down" animation
  npc.playAnimation('alight_vehicle');

  // Remove from passengers
  vehicle.passengers = vehicle.passengers.filter(p => p !== npc);

  // Continue journey
  npc.state = 'walking';
}
```

#### Summary: Transit That Feels Real

| What Player Sees | What's Actually Happening |
|------------------|---------------------------|
| NPC walks to bus stop | Normal pathfinding |
| NPC waits at stop | State = 'waiting', idle animation |
| Bus arrives, NPC gets on | NPC becomes invisible, added to passengers[] |
| Bus drives between stops | Vehicle follows route, passengers are just references |
| NPC gets off at stop | NPC becomes visible at stop position |
| NPC walks to destination | Normal pathfinding resumes |
| Multi-modal trip | State machine walks through TransitPath legs |

**Key insight:** The vehicle's `passengers[]` array is just a list of invisible NPCs. No seats, no capacity limits (or just a simple `if passengers.length < capacity`). The "riding" is just hiding + position sync.

---

### Tiered NPC System: Real vs. Simulated

The golden ratio: **50-100 "real" NPCs** with full simulation, the rest are **abstract eye candy**.

#### Tier 1: Real NPCs (50-100)

These have actual brains:

```typescript
interface RealNPC {
  id: string;
  seed: number;              // Deterministic identity
  position: Position;
  destination: Position;
  path: Position[];          // Actual A* path
  state: NPCState;
  transitPlan?: TransitPath; // Multi-modal journey

  // Full simulation
  needs: {
    work: boolean;
    shop: boolean;
    leisure: boolean;
  };
  schedule: DaySchedule;

  // Can be interacted with
  canChat: boolean;          // AI chat enabled
}

type NPCState =
  | 'walking'
  | 'waiting_for_transit'
  | 'riding_transit'
  | 'at_destination'
  | 'idle';
```

**These NPCs:**
- Have real A* pathfinding (staggered, 5-10 per frame)
- Can board/ride/exit transit
- Follow schedules (home → work → shop → home)
- Can be clicked and chatted with (AI feature)
- Persist across save/load if tracked

#### Tier 2: Simulated NPCs (Unlimited)

These are just sprites following rules:

```typescript
interface SimulatedNPC {
  sprite: Phaser.Sprite;
  flowDirection: Direction;  // From flow lanes
  speed: number;
  lifetime: number;          // Despawn after this
}

// Spawned based on zone population, not tracked individually
function spawnSimulatedNPCs(): void {
  for (const zone of residentialZones) {
    const population = zone.population;
    const npcsToShow = Math.floor(population / 50);  // 1 sprite per 50 pop

    for (let i = 0; i < npcsToShow; i++) {
      if (isInViewport(zone) && currentNPCCount < MAX_SIMULATED) {
        spawnSimulatedNPC(zone.position);
      }
    }
  }
}

// Update is trivial - just follow flow
function updateSimulatedNPC(npc: SimulatedNPC, delta: number): void {
  const road = getRoadAt(npc.position);
  if (road) {
    npc.flowDirection = road.flow.toCommercial;  // Or random
  }

  moveInDirection(npc, npc.flowDirection, npc.speed * delta);

  npc.lifetime -= delta;
  if (npc.lifetime <= 0 || isOffScreen(npc)) {
    despawn(npc);
  }
}
```

**These NPCs:**
- No pathfinding (follow flow lanes)
- No state machine (just walk until despawn)
- No persistence (respawn from zones)
- Cannot be interacted with
- Spawn/despawn at viewport edges

#### The Hybrid: Promotion & Demotion

NPCs can move between tiers:

```typescript
// Player clicks a simulated NPC → promote to real
function onNPCClick(npc: SimulatedNPC | RealNPC): void {
  if (npc instanceof SimulatedNPC) {
    // Promote to real NPC for interaction
    const realNPC = promoteToReal(npc);
    openChatDialog(realNPC);
  } else {
    openChatDialog(npc);
  }
}

function promoteToReal(sim: SimulatedNPC): RealNPC {
  // Generate identity from position + time as seed
  const seed = hashPosition(sim.position) + gameTime.tick;

  const real: RealNPC = {
    id: generateId(),
    seed,
    position: sim.position,
    destination: pickRandomDestination(),
    path: [],  // Will pathfind next frame
    state: 'walking',
    canChat: true,
    // ... generate rest from seed
  };

  // Despawn the simulated version
  despawn(sim);

  // Add to real NPC pool (enforce limit)
  if (realNPCs.length >= MAX_REAL_NPCS) {
    demoteOldest();
  }
  realNPCs.push(real);

  return real;
}

function demoteOldest(): void {
  // Find least recently interacted, non-tracked NPC
  const toRemove = realNPCs
    .filter(n => !n.isTracked)
    .sort((a, b) => a.lastInteraction - b.lastInteraction)[0];

  if (toRemove) {
    // Just remove - a simulated one will spawn naturally
    realNPCs.splice(realNPCs.indexOf(toRemove), 1);
  }
}
```

#### Performance Budget

```
┌─────────────────────────────────────────────────────────┐
│                    NPC BUDGET                           │
├─────────────────────────────────────────────────────────┤
│  Tier 1: Real NPCs                                      │
│  ├─ Max count: 100                                      │
│  ├─ Pathfinding: 5-10 per frame (staggered)             │
│  ├─ State updates: Every frame                          │
│  ├─ Transit riding: Full simulation                     │
│  └─ Memory: ~500 bytes each = 50KB                      │
│                                                         │
│  Tier 2: Simulated NPCs                                 │
│  ├─ Max visible: 500                                    │
│  ├─ Pathfinding: NONE (flow lanes)                      │
│  ├─ Updates: Position only                              │
│  ├─ Spawned from: Zone population                       │
│  └─ Memory: ~50 bytes each = 25KB                       │
│                                                         │
│  Tier 3: Abstract (not rendered)                        │
│  ├─ Count: Unlimited (just numbers)                     │
│  ├─ Represents: Actual population                       │
│  └─ Memory: Part of zone data                           │
│                                                         │
│  TOTAL: 100 real + 500 simulated = 600 visible          │
│         Representing 50,000+ abstract population        │
└─────────────────────────────────────────────────────────┘
```

#### The Magic Trick

```
Population: 50,000 citizens

What's simulated:
  - 100 real NPCs with full AI
  - 500 sprite NPCs following flow lanes

What player perceives:
  - "Wow, this city feels alive!"
  - "I can talk to anyone!"
  - "The transit system works!"

What's actually happening:
  - 99.8% of "citizens" are just numbers in zone.population
  - Click any sprite → instantly becomes real with generated identity
  - Transit coverage is a radius, not passenger simulation
```

#### Summary: The Illusion of Traffic

| What Player Sees | What's Actually Happening |
|------------------|---------------------------|
| Cars on busy roads | Sprites spawned based on usage number |
| Traffic jams | High congestion %, slower car sprites |
| Rush hour | Time multiplier on usage |
| Transit reducing traffic | Coverage radius reduces "effective distance" |
| Commuters going to work | Flow lanes, not pathfinding |
| Road capacity matters | Higher capacity = higher usage threshold |

**The Rule:** Simulation computes NUMBERS (usage, congestion, coverage).
Phaser shows PICTURES of those numbers (cars, buses, density).
The pictures never affect the numbers.

---

## Phase 5: Events System

### Petitions (SC3K style)
- [ ] **Citizen petitions** - Popup requests from residents
  - "We need a park in Westside!"
  - "Traffic on Main Street is terrible!"
  - "Please lower taxes!"
- [ ] **Reward/consequence** - Fulfilling affects approval
- [ ] **Petition types**: Zoning, services, taxes, environment

### Disasters & Emergencies
- [ ] **Fire outbreaks** - Spread if not contained
- [ ] **Crime waves** - Spike in crime rate
- [ ] **Epidemics** - Health crisis
- [ ] **Infrastructure failure** - Power outage, water main break
- [ ] **Natural disasters** - Earthquake, tornado, flood (optional/toggle)
- [ ] **Emergency response** - Deploy services, rebuild

### Special Events
- [ ] **Positive events**:
  - New business wants to move in
  - Festival/parade (happiness boost)
  - Government grant offered
  - Sports team wants stadium
- [ ] **Negative events**:
  - Factory closing
  - Scandal reduces approval
  - Neighboring city competition
- [ ] **Timed decisions** - Accept/decline with consequences

### News Ticker / Headlines
- [ ] Scrolling news about city events
- [ ] Dynamic headlines based on city state
- [ ] Adds life and feedback to simulation

---

## Phase 6: Polish & Advanced Features

### Data Views & Overlays
- [ ] **Zone view** - Show R/C/I colors
- [ ] **Traffic view** - Heat map of congestion
- [ ] **Land value view** - Value gradient
- [ ] **Crime view** - Crime rate heat map
- [ ] **Pollution view** - Air/ground pollution
- [ ] **Service coverage** - Police/fire/health radius

### Statistics & Graphs
- [ ] Population over time
- [ ] Budget history
- [ ] Zone demand history
- [ ] Approval rating
- [ ] City milestones

### Save/Load System
- [ ] Serialize grid state
- [ ] Save simulation state
- [ ] Multiple save slots
- [ ] Auto-save

### Sound & Music
- [x] Background music (chill/jazz)
- [x] UI sounds
- [ ] Ambient city sounds
- [ ] Event-specific sounds

---

## Technical Notes

### Depth Sorting (Already documented in MainScene.ts)
```
Layer offsets:
  0.00 - Ground tiles
  0.03 - Back fences
  0.04 - Lamp glow
  0.05 - Buildings
  0.06 - Props/trees
  0.07 - Front fences
  0.08-0.09 - Traffic light overhangs
  0.10 - Cars
  0.20 - Characters
```

### Performance Considerations
- Chunk-based rendering for large maps
- LOD for zoomed out view
- Simulation tick rate separate from render rate
- Web workers for heavy simulation calculations

### Data Structures
```typescript
// Lot definition
interface LotDefinition {
  id: string;
  building: string;  // Building ID
  props: Array<{ id: string; offsetX: number; offsetY: number }>;
  style: 'suburban' | 'urban' | 'historic' | 'modern';
  wealthLevel: 1 | 2 | 3;
  zoneType: 'R' | 'C' | 'I';
  density: 'low' | 'medium' | 'high';
}

// Simulation state (per tile)
interface SimulationTile {
  zoneType?: 'R' | 'C' | 'I';
  zoneDensity?: 'low' | 'medium' | 'high';
  landValue: number;
  pollution: number;
  crime: number;
  services: {
    police: number;  // 0-100 coverage
    fire: number;
    health: number;
    education: number;
  };
  power: boolean;
  water: boolean;
}
```

---

## Inspiration References

- **SimCity 3000** - Advisors, petitions, zone growth, budget
- **SimCity 4** - Region play, more detailed simulation, NAM traffic
- **Cities: Skylines** - Modern traffic simulation, policies
- **OpenTTD** - Transparent simulation, moddability
- **Theotown** - Mobile-friendly SC clone, good reference for simplification

---

## Implementation Notes (Based on Current Codebase)

### The 3-Layer Architecture

The game should be thought of as 3 distinct layers:

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: SIMULATION (React)                                 │
│  ════════════════════════════════════════                    │
│  Source of truth for game state                              │
│  - Grid (buildings, zones, roads)                            │
│  - Budget, population, demand                                │
│  - Time progression                                          │
│  - Zone growth/decay logic                                   │
│  - Events, advisors                                          │
│                                                              │
│  Lives in: GameBoard.tsx + app/simulation/                   │
│  Persisted: YES (save/load)                                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      │ grid, simData (one-way push)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2: RENDERING (Phaser)                                 │
│  ════════════════════════════════════════                    │
│  Pure visualization of Layer 1                               │
│  - Tile sprites, building sprites                            │
│  - Depth sorting, vertical slicing                           │
│  - Camera controls, zoom, pan                                │
│  - Data overlays (zones, traffic, etc.)                      │
│  - UI feedback (hover, selection)                            │
│                                                              │
│  Lives in: MainScene.ts (rendering methods)                  │
│  Persisted: NO (rebuilt from Layer 1)                        │
└─────────────────────────────────────────────────────────────┘
                      │
                      │ reads grid (reference)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: COSMETIC AGENTS (Phaser)                           │
│  ════════════════════════════════════════                    │
│  Eye candy that reacts to the world                          │
│  - NPCs (pedestrians)                                        │
│  - Cars (traffic)                                            │
│  - Ambient animations                                        │
│                                                              │
│  Lives in: MainScene.ts (character/car methods)              │
│  Persisted: NO (respawned on load, quasi-random)            │
└─────────────────────────────────────────────────────────────┘
```

---

### Current State: Where Things Live

**Grid Source of Truth: React (GameBoard.tsx)**
```typescript
// GameBoard.tsx:92
const [grid, setGrid] = useState<GridCell[][]>(createEmptyGrid);
```

**Grid Copy for Rendering: Phaser (MainScene.ts)**
```typescript
// MainScene.ts:1316
updateGrid(newGrid: GridCell[][]): void {
  // Copies grid from React, marks dirty tiles for re-render
  this.grid = newGrid;  // Actually a reference, be careful!
}
```

**NPCs & Cars: Phaser only (MainScene.ts)**
```typescript
// Managed entirely in Phaser, no React involvement
private characters: Character[] = [];
private cars: Car[] = [];
```

---

### The Clean Architecture Vision

```
┌────────────────────────────────────────────────────────────────────┐
│                         REACT UNIVERSE                              │
│                                                                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│  │  GameBoard   │    │  Simulation  │    │    UI        │         │
│  │  (state hub) │◄───│  (logic)     │    │  (panels)    │         │
│  └──────┬───────┘    └──────────────┘    └──────────────┘         │
│         │                                                          │
│         │ grid, simData, time                                      │
│         ▼                                                          │
│  ┌──────────────┐                                                  │
│  │ PhaserGame   │  (React wrapper, passes data down)               │
│  └──────┬───────┘                                                  │
└─────────┼──────────────────────────────────────────────────────────┘
          │
          │ updateGrid(), updateSimData(), updateTime()
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        PHASER UNIVERSE                              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      MainScene.ts                            │   │
│  │                                                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐                   │   │
│  │  │  RENDERER       │  │  AGENT MANAGER  │                   │   │
│  │  │  ───────────    │  │  ─────────────  │                   │   │
│  │  │  • renderTiles  │  │  • spawnNPC     │                   │   │
│  │  │  • renderBldgs  │  │  • updateNPCs   │                   │   │
│  │  │  • renderOverlay│  │  • spawnCar     │                   │   │
│  │  │                 │  │  • updateCars   │                   │   │
│  │  │  Reads: grid    │  │  Reads: grid    │                   │   │
│  │  │  Writes: nothing│  │  Writes: nothing│                   │   │
│  │  └─────────────────┘  └─────────────────┘                   │   │
│  │                                                              │   │
│  │  Grid is READ-ONLY in Phaser!                               │   │
│  │  All mutations happen in React, flow down.                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Key Principles

#### 1. **One-Way Data Flow**
```
React (source of truth) ──────► Phaser (renders it)
                         NEVER ◄──────
```
- Grid changes happen in React via `setGrid()`
- React pushes new grid to Phaser via `updateGrid()`
- Phaser NEVER modifies the grid, only reads it
- User input in Phaser emits events back to React (click positions, etc.)

#### 2. **Simulation is Pure Functions**
```typescript
// app/simulation/tick.ts

// Simulation takes current state, returns new state
// NO side effects, NO rendering, NO Phaser dependency
function simulationTick(state: GameState): GameState {
  let newState = { ...state };

  newState = updateTime(newState);
  newState = updateBudget(newState);
  newState = updateDemand(newState);
  newState = evaluateZoneGrowth(newState);
  newState = checkEvents(newState);

  return newState;
}

// Called from React on interval
useEffect(() => {
  const interval = setInterval(() => {
    setGameState(prev => simulationTick(prev));
  }, tickRate);
  return () => clearInterval(interval);
}, [tickRate]);
```

#### 3. **Agents are Ephemeral**
```typescript
// NPCs and cars are NOT part of game state
// They exist only in Phaser, respawn on load
// They READ the grid to make decisions, but don't modify it

class AgentManager {
  private grid: GridCell[][];  // Reference from React

  updateAgents(deltaTime: number) {
    for (const npc of this.npcs) {
      // Read grid to make pathfinding decisions
      const nextTile = this.pickNextTile(npc, this.grid);
      npc.moveTo(nextTile);
    }
  }

  // On game load, respawn agents based on grid
  respawnAgents() {
    this.npcs = [];
    this.cars = [];

    // Spawn NPCs near residential
    const residentialTiles = this.findZones('R');
    for (let i = 0; i < targetNPCCount; i++) {
      const tile = randomPick(residentialTiles);
      this.spawnNPC(tile.x, tile.y);
    }

    // Spawn cars on roads
    const roadTiles = this.findRoads();
    for (let i = 0; i < targetCarCount; i++) {
      const tile = randomPick(roadTiles);
      this.spawnCar(tile.x, tile.y);
    }
  }
}
```

#### 4. **What Gets Saved vs. Rebuilt**

| Data | Saved? | On Load |
|------|--------|---------|
| Grid (tiles, buildings, zones) | ✅ YES | Loaded from save |
| Budget, treasury | ✅ YES | Loaded from save |
| Time (year, month, day) | ✅ YES | Loaded from save |
| Population, demand | ✅ YES | Loaded from save |
| Active events | ✅ YES | Loaded from save |
| History/graphs | ✅ YES | Loaded from save |
| SimulationGrid (land value, etc.) | ❌ NO | Recomputed from grid |
| NPCs | ❌ NO | Respawned based on zones |
| Cars | ❌ NO | Respawned based on roads |
| Sprites/visuals | ❌ NO | Rebuilt from grid |

---

### NPC/Car Weighted Spawning & Movement

Since agents are cosmetic, they should feel "alive" without true simulation:

```typescript
// app/components/game/phaser/AgentManager.ts

interface AgentConfig {
  // How many agents based on city size
  npcsPerResidentialTile: number;   // e.g., 0.1 = 1 NPC per 10 R tiles
  carsPerRoadTile: number;          // e.g., 0.05 = 1 car per 20 road tiles
  maxNPCs: number;                  // Cap for performance
  maxCars: number;
}

class AgentManager {
  // Weighted tile selection for spawning
  private getSpawnWeights(type: 'npc' | 'car'): Map<string, number> {
    const weights = new Map<string, number>();

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const cell = this.grid[y][x];
        let weight = 0;

        if (type === 'npc') {
          // NPCs spawn near residential, commercial, landmarks
          if (cell.zone?.type === 'R') weight += 3;
          if (cell.zone?.type === 'C') weight += 2;
          if (cell.buildingId && isLandmark(cell.buildingId)) weight += 5;
          if (cell.type === TileType.Tile) weight += 1;  // Sidewalks
        } else {
          // Cars spawn on roads
          if (cell.type === TileType.Road) weight += 2;
          if (cell.type === TileType.Asphalt) weight += 1;
        }

        if (weight > 0) {
          weights.set(`${x},${y}`, weight);
        }
      }
    }

    return weights;
  }

  // Time-of-day affects movement patterns
  private getDestinationWeights(agent: Agent, hour: number): Map<string, number> {
    const weights = new Map<string, number>();
    const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);
    const isWeekend = this.gameTime.day % 7 >= 5;

    for (const [key, cell] of this.iterateGrid()) {
      let weight = 0;

      if (isRushHour && !isWeekend) {
        // Commute patterns
        if (hour < 12) {
          // Morning: toward work
          if (cell.zone?.type === 'C') weight += 5;
          if (cell.zone?.type === 'I') weight += 4;
        } else {
          // Evening: toward home
          if (cell.zone?.type === 'R') weight += 5;
        }
      } else {
        // Leisure patterns
        if (isLandmark(cell.buildingId)) weight += 4;
        if (isPark(cell.buildingId)) weight += 3;
        if (cell.zone?.type === 'C') weight += 2;  // Shopping
      }

      // Always some randomness
      weight += Math.random() * 2;

      if (weight > 0) {
        weights.set(key, weight);
      }
    }

    return weights;
  }
}
```

---

### React ↔ Phaser Communication

**React → Phaser (data push):**
```typescript
// PhaserGame.tsx
useEffect(() => {
  if (sceneRef.current) {
    sceneRef.current.updateGrid(grid);
    sceneRef.current.updateSimData(simData);
    sceneRef.current.updateTime(gameTime);
  }
}, [grid, simData, gameTime]);
```

**Phaser → React (events):**
```typescript
// MainScene.ts
this.events.emit('tileClicked', { x, y, button });
this.events.emit('zoomChanged', newZoom);
this.events.emit('cameraMove', { scrollX, scrollY });

// PhaserGame.tsx
useEffect(() => {
  scene.events.on('tileClicked', handleTileClick);
  scene.events.on('zoomChanged', onZoomChange);
  return () => {
    scene.events.off('tileClicked', handleTileClick);
    scene.events.off('zoomChanged', onZoomChange);
  };
}, []);
```

---

### Simulation Tick Scheduling

```typescript
// GameBoard.tsx or custom hook

const TICK_INTERVALS = {
  paused: null,
  slow: 2000,      // 1 game hour = 2 real seconds
  normal: 500,     // 1 game hour = 0.5 real seconds
  fast: 100,       // 1 game hour = 0.1 real seconds
  ultra: 20,       // Warp speed for skipping time
};

function useSimulation(speed: SimSpeed) {
  const [gameState, setGameState] = useState<GameState>(initialState);

  useEffect(() => {
    const interval = TICK_INTERVALS[speed];
    if (!interval) return;  // Paused

    const timer = setInterval(() => {
      setGameState(prev => {
        // Pure function, no side effects
        const next = simulationTick(prev);

        // Push to Phaser after state update
        phaserRef.current?.updateTime(next.time);
        phaserRef.current?.updateSimData(next.simData);

        return next;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [speed]);

  return gameState;
}
```

---

### Why This Architecture?

1. **Testable**: Simulation is pure functions, easy to unit test
2. **Debuggable**: Clear data flow, easy to trace bugs
3. **Performant**: Phaser only renders, doesn't compute simulation
4. **Saveable**: Clear separation of persistent vs. ephemeral state
5. **Maintainable**: Each layer has single responsibility
6. **Familiar**: React devs understand React, game devs understand Phaser

---

### Simulation Philosophy: Abstract Over Agents

**The SC2013/Cities Skylines problem:**
Agents (garbage trucks, fire trucks) must physically reach destinations.
Traffic jam → trucks can't arrive → garbage piles up → city collapses.
One system failure cascades into total breakdown.

**The SC4/Pogicity approach:**
Simulation uses abstract coverage %, not agent pathfinding.
Agents are eye candy that visualize outcomes, not determine them.

```
WRONG:  Fire truck arrives → Fire goes out (agent determines outcome)
RIGHT:  Coverage exists → Fire goes out → Truck animates (abstract determines outcome)
```

**What this means in practice:**

| Event | Simulation (React) | Visualization (Phaser) |
|-------|-------------------|------------------------|
| Fire | Coverage % → spread/contain | Fire sprites + truck driving |
| Crime | Crime rate from coverage | Police cars patrolling |
| Traffic | Congestion % per road | Car density matches % |
| Garbage | Pickup rate from coverage | Garbage trucks driving |
| Health | Life expectancy stat | Ambulances responding |

**The rule:** Simulation is a spreadsheet. Phaser is a movie of that spreadsheet.
The movie doesn't change the numbers.

**Phaser → React communication:**
- Tile clicks (player input)
- UI events (zoom, pan)
- OPTIONAL: "truck arrived" for news ticker flavor
- NEVER: "truck arrived, now update simulation"

### Key Files to Extend
| File | Current Role | Simulation Extension |
|------|--------------|---------------------|
| `types.ts` | Grid cell types, TileType enum | Add zone types, simulation data |
| `buildings.ts` | Building definitions | Add lot definitions, growth stages |
| `GameBoard.tsx` | Grid state, placement | Budget state, simulation tick trigger |
| `MainScene.ts` | Rendering only | Data overlays, NPC destination logic |
| *NEW* `simulation/` | - | Core sim logic, separate from rendering |

---

### Time System Implementation

The game currently has no concept of time. Here's how to add it:

```typescript
// New file: app/simulation/TimeManager.ts

export interface GameTime {
  tick: number;           // Increments every sim update
  hour: number;           // 0-23
  day: number;            // 1-31
  month: number;          // 1-12
  year: number;           // Starting year (e.g., 2000)
  speed: 'paused' | 'normal' | 'fast' | 'ultra';
}

// Tick rates (ms between simulation ticks)
const TICK_RATES = {
  paused: Infinity,
  normal: 1000,    // 1 tick/sec - 1 tick = 1 game hour
  fast: 250,       // 4 ticks/sec
  ultra: 50,       // 20 ticks/sec
};

// In GameBoard.tsx, add useEffect for simulation loop:
useEffect(() => {
  if (gameTime.speed === 'paused') return;

  const interval = setInterval(() => {
    // Advance time
    setGameTime(prev => advanceTime(prev));

    // Run simulation tick
    runSimulationTick();
  }, TICK_RATES[gameTime.speed]);

  return () => clearInterval(interval);
}, [gameTime.speed]);
```

**Time-based triggers:**
- Every hour: NPC movement patterns, traffic updates
- Every day: Budget income/expenses, random events check
- Every week: Zone growth/decay evaluation
- Every month: Advisor reports, demand recalculation
- Every year: Statistics snapshot, milestones check

---

### Extending the Grid Cell

Current `GridCell` in `types.ts`:
```typescript
interface GridCell {
  type: TileType;
  buildingId?: string;
  isOrigin?: boolean;
  originX?: number;
  originY?: number;
  underlyingTileType?: TileType;
  buildingOrientation?: Direction;
}
```

**Extended for simulation:**
```typescript
interface GridCell {
  // Existing
  type: TileType;
  buildingId?: string;
  isOrigin?: boolean;
  originX?: number;
  originY?: number;
  underlyingTileType?: TileType;
  buildingOrientation?: Direction;

  // NEW: Zoning (separate from building)
  zone?: {
    type: 'R' | 'C' | 'I';
    density: 'low' | 'medium' | 'high';
  };

  // NEW: Simulation data (computed, not stored in save)
  // Keep in separate SimulationGrid to avoid bloating saves
}

// Separate simulation layer (computed each tick, not saved)
interface SimulationGrid {
  cells: SimulationCell[][];
}

interface SimulationCell {
  landValue: number;        // 0-100
  pollution: number;        // 0-100
  crime: number;            // 0-100
  traffic: number;          // 0-100
  desirability: number;     // Computed from above

  // Service coverage (0-100, computed from service buildings)
  police: number;
  fire: number;
  health: number;
  education: number;

  // Utilities
  hasPower: boolean;
  hasWater: boolean;
}
```

---

### Simulation Module Structure

```
app/
├── simulation/
│   ├── index.ts              # Export all simulation functions
│   ├── TimeManager.ts        # Time progression, speed control
│   ├── BudgetManager.ts      # Income, expenses, loans
│   ├── DemandManager.ts      # R/C/I demand calculation
│   ├── ZoneGrowth.ts         # Lot development/decay logic
│   ├── ServiceCoverage.ts    # Police/fire/health radius calc
│   ├── TrafficSim.ts         # Road usage, congestion
│   ├── LandValue.ts          # Land value computation
│   ├── EventManager.ts       # Random events, petitions
│   └── NPCManager.ts         # Character behavior patterns
```

**Keep simulation SEPARATE from rendering:**
- Simulation runs in `GameBoard.tsx` (or dedicated hook)
- Results passed to `MainScene.ts` only for visualization
- Allows simulation to run without rendering (fast-forward)

---

### Zone Growth Algorithm (SC3K-style)

```typescript
// app/simulation/ZoneGrowth.ts

function evaluateZoneGrowth(grid: Grid, simGrid: SimulationGrid) {
  for (const zone of getZonedTiles(grid)) {
    if (zone.hasBuilding) continue;  // Already developed

    const sim = simGrid.cells[zone.y][zone.x];
    const demand = getDemand(zone.type);  // R/C/I demand bar

    // Growth chance based on conditions
    let growthChance = demand * 0.01;  // Base: 1% per demand point

    // Modifiers
    growthChance *= (sim.landValue / 50);         // Higher land value = faster
    growthChance *= (sim.desirability / 50);      // More desirable = faster
    growthChance *= sim.hasPower ? 1 : 0;         // No power = no growth
    growthChance *= hasRoadAccess(zone) ? 1 : 0;  // Need road connection

    if (Math.random() < growthChance) {
      // Pick appropriate lot for zone type, density, wealth
      const lot = selectLotForZone(zone, sim.landValue);
      developLot(grid, zone, lot);
    }
  }
}
```

---

### NPC Quasi-Random Pathfinding

Current NPCs walk randomly. Upgrade to weighted destinations:

```typescript
// app/simulation/NPCManager.ts

interface NPCDestination {
  x: number;
  y: number;
  weight: number;  // Higher = more attractive
  type: 'work' | 'shop' | 'park' | 'home' | 'wander';
}

function pickDestination(npc: Character, time: GameTime): NPCDestination {
  const hour = time.hour;
  const isWeekend = time.day % 7 >= 5;

  // Build weighted destination list based on time
  const destinations: NPCDestination[] = [];

  if (!isWeekend && hour >= 7 && hour <= 9) {
    // Morning commute: weight toward C/I zones
    destinations.push(...getZoneDestinations('C', 10));
    destinations.push(...getZoneDestinations('I', 8));
  } else if (!isWeekend && hour >= 17 && hour <= 19) {
    // Evening commute: weight toward R zones
    destinations.push(...getZoneDestinations('R', 10));
  } else if (isWeekend || (hour >= 11 && hour <= 14)) {
    // Leisure time: parks, landmarks, commercial
    destinations.push(...getLandmarkDestinations(8));
    destinations.push(...getParkDestinations(6));
    destinations.push(...getZoneDestinations('C', 4));
  }

  // Always add some random wandering
  destinations.push(...getRandomDestinations(2));

  return weightedRandomPick(destinations);
}

// Then use A* pathfinding to reach destination
// Prefer roads, avoid cutting through buildings
```

---

### AI-Powered NPC Interaction (Experimental)

A unique feature: click any NPC to chat with them via LLM. They know the map, have personalities, and can respond to commands.

**Core Concept:**
- NPCs are lightweight (deterministic from seed, ~30 bytes each)
- When clicked, we build context from their seed + world state
- Feed context to LLM, get response with optional actions
- Parse actions like `ACTION: GOTO x y` and execute them

**Implementation Approach:**

```typescript
// app/simulation/AgentChat.ts

interface AgentIdentity {
  seed: number;           // Deterministic identity
  name: string;           // Generated from seed
  personality: string;    // "cheerful", "grumpy", "curious", etc.
  occupation: string;     // "office worker", "student", "retiree"
  homeZone: { x: number; y: number };  // Their "home" area
}

// Build identity from seed (no storage needed!)
function getAgentIdentity(seed: number): AgentIdentity {
  const rng = seedRandom(seed);

  return {
    seed,
    name: NAMES[Math.floor(rng() * NAMES.length)],
    personality: PERSONALITIES[Math.floor(rng() * PERSONALITIES.length)],
    occupation: OCCUPATIONS[Math.floor(rng() * OCCUPATIONS.length)],
    homeZone: { x: Math.floor(rng() * GRID_WIDTH), y: Math.floor(rng() * GRID_HEIGHT) },
  };
}

// Build context for LLM
function buildAgentContext(agent: Agent, city: CityState): string {
  const identity = getAgentIdentity(agent.seed);
  const nearbyBuildings = getBuildingsNear(agent.x, agent.y, 5);
  const landmarks = city.landmarks.map(l => l.name);

  return `
You are ${identity.name}, a ${identity.personality} ${identity.occupation} in Pogicity.
You're currently at (${agent.x}, ${agent.y}) near: ${nearbyBuildings.join(', ')}.

The city has these landmarks: ${landmarks.join(', ')}.
Current time: ${city.time.hour}:00, ${city.time.month}/${city.time.day}/${city.time.year}

You can respond naturally to the player. If they ask you to go somewhere,
include an action at the end of your response:
ACTION: GOTO [x] [y]

Respond in character as ${identity.name}. Keep responses short (1-3 sentences).
`.trim();
}

// Chat with an agent
async function chatWithAgent(
  agent: Agent,
  userMessage: string,
  city: CityState
): Promise<{ response: string; action?: AgentAction }> {
  const context = buildAgentContext(agent, city);

  const llmResponse = await callLLM({
    system: context,
    user: userMessage,
  });

  // Parse any actions from response
  const action = parseAction(llmResponse);
  const cleanResponse = llmResponse.replace(/ACTION:.*$/gm, '').trim();

  return { response: cleanResponse, action };
}

// Parse ACTION commands from LLM response
function parseAction(response: string): AgentAction | undefined {
  const gotoMatch = response.match(/ACTION:\s*GOTO\s+(\d+)\s+(\d+)/i);
  if (gotoMatch) {
    return {
      type: 'goto',
      target: { x: parseInt(gotoMatch[1]), y: parseInt(gotoMatch[2]) },
    };
  }

  const lookMatch = response.match(/ACTION:\s*LOOK\s+AT\s+(.+)/i);
  if (lookMatch) {
    const building = findBuildingByName(lookMatch[1]);
    if (building) {
      return { type: 'goto', target: building.position };
    }
  }

  return undefined;
}

type AgentAction =
  | { type: 'goto'; target: { x: number; y: number } }
  | { type: 'wave' }
  | { type: 'sit' }
  | { type: 'idle'; duration: number };
```

**Example Interactions:**

```
Player: "Hey! What are you up to?"
Agent (cheerful office worker):
  "Oh hi! Just heading to work at the Tech Office.
   Love this weather today!"

Player: "Can you go check out the new park?"
Agent:
  "Sure thing! I've been meaning to see it anyway.
   ACTION: GOTO 24 18"

Player: "What do you think of the city?"
Agent (grumpy retiree):
  "Traffic's gotten worse. Back in my day, you could
   walk anywhere. At least the Internet Archive is nice."
```

**UI Concept:**

```
┌─────────────────────────────────────┐
│  💬 Marcus (Office Worker)          │
│  ─────────────────────────────────  │
│  "Just heading to work! The new     │
│   coffee shop on Main St is great." │
│                                     │
│  ┌─────────────────────────────┐    │
│  │ Say something...            │    │
│  └─────────────────────────────┘    │
│                                     │
│  [Ask about city] [Send somewhere]  │
└─────────────────────────────────────┘
```

**"Tracked Friends" System (RCT-inspired):**

Like RollerCoaster Tycoon, most agents are anonymous and ephemeral. But the player can "star" up to 6 agents to track:

```typescript
interface TrackedAgent {
  seed: number;              // Their identity
  nickname?: string;         // Player-given name
  currentPosition: { x: number; y: number };
  chatHistory: ChatMessage[];  // Last N messages
  stats: {
    happiness: number;
    visited: string[];       // Landmarks they've seen
  };
}

// Tracked agents persist across saves
// They get the "full simulation" treatment:
// - Actual pathfinding
// - Persistent state
// - Can be followed on map
// - Notify player of interesting events

// Untracked agents are just eye candy:
// - Deterministic from position + time
// - No persistent state
// - Respawn on load
```

**Performance Notes:**

- Only build LLM context when player clicks an agent
- Cache recent conversations per seed
- Tracked agents (max 6) get persistence
- All others are stateless, identity from seed
- No impact on simulation performance

**Why This Is Cool:**

1. **Emergent storytelling** - Each citizen has a personality
2. **City feels alive** - NPCs have opinions about landmarks, traffic
3. **Player agency** - Send NPCs on missions, watch them explore
4. **Low overhead** - Identity is computed, not stored
5. **Scalable** - Works with 1000s of agents, only active when clicked

---

### Event System Architecture

```typescript
// app/simulation/EventManager.ts

interface GameEvent {
  id: string;
  type: 'petition' | 'disaster' | 'opportunity' | 'news';
  title: string;
  description: string;
  choices?: EventChoice[];
  autoResolve?: boolean;
  duration?: number;  // Ticks until expires
  effects: EventEffect[];
}

interface EventChoice {
  label: string;
  effects: EventEffect[];
  cost?: number;
}

interface EventEffect {
  type: 'happiness' | 'money' | 'demand' | 'service' | 'spawn_building';
  target?: string;
  value: number;
}

// Event triggers
const EVENT_TRIGGERS = {
  // Petitions trigger based on city conditions
  'petition_park': (city) => city.parkCoverage < 30 && city.population > 1000,
  'petition_traffic': (city) => city.avgTraffic > 70,
  'petition_taxes': (city) => city.taxRate > 10 && city.happiness < 50,

  // Disasters trigger randomly with probability
  'fire_outbreak': (city) => Math.random() < 0.001 * (100 - city.fireCoverage),
  'crime_wave': (city) => Math.random() < 0.001 * city.crime,
};

// Check for events each day
function checkForEvents(city: CityState): GameEvent | null {
  for (const [eventId, trigger] of Object.entries(EVENT_TRIGGERS)) {
    if (trigger(city) && !recentlyTriggered(eventId)) {
      return createEvent(eventId);
    }
  }
  return null;
}
```

---

### Budget System

```typescript
// app/simulation/BudgetManager.ts

interface Budget {
  treasury: number;

  // Monthly income
  income: {
    residentialTax: number;
    commercialTax: number;
    industrialTax: number;
    deals: number;  // Special deals, neighbor connections
  };

  // Monthly expenses
  expenses: {
    police: number;      // Based on funding slider
    fire: number;
    health: number;
    education: number;
    transportation: number;  // Road maintenance
    utilities: number;
    loanPayments: number;
  };

  // Tax rates (0-20%)
  taxRates: {
    residential: number;
    commercial: number;
    industrial: number;
  };

  // Funding levels (0-100%)
  funding: {
    police: number;
    fire: number;
    health: number;
    education: number;
    transportation: number;
  };

  loans: Loan[];
}

// Calculate monthly income
function calculateMonthlyIncome(city: CityState, budget: Budget): number {
  const rPop = city.residentialPopulation;
  const cJobs = city.commercialJobs;
  const iJobs = city.industrialJobs;

  // Base income per unit, modified by tax rate
  const rIncome = rPop * 10 * (budget.taxRates.residential / 100);
  const cIncome = cJobs * 15 * (budget.taxRates.commercial / 100);
  const iIncome = iJobs * 12 * (budget.taxRates.industrial / 100);

  return rIncome + cIncome + iIncome + budget.income.deals;
}
```

---

### Advisor System

```typescript
// app/simulation/advisors/

interface Advisor {
  id: string;
  name: string;
  role: string;
  portrait: string;  // Image path
  personality: 'optimistic' | 'cautious' | 'aggressive';

  // Generate advice based on city state
  getAdvice(city: CityState): AdvisorMessage[];

  // React to player actions
  reactToAction(action: PlayerAction): AdvisorMessage | null;
}

interface AdvisorMessage {
  advisorId: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  title: string;
  message: string;
  suggestions?: string[];
  relatedTiles?: { x: number; y: number }[];  // Highlight on map
}

// Example advisor logic
class FinanceAdvisor implements Advisor {
  getAdvice(city: CityState): AdvisorMessage[] {
    const messages: AdvisorMessage[] = [];

    if (city.budget.treasury < 0) {
      messages.push({
        advisorId: 'finance',
        priority: 'urgent',
        title: 'Budget Crisis!',
        message: `We're $${Math.abs(city.budget.treasury)} in debt!`,
        suggestions: [
          'Raise taxes temporarily',
          'Cut service funding',
          'Take out a loan',
        ],
      });
    }

    if (city.budget.monthlyBalance < 0) {
      messages.push({
        advisorId: 'finance',
        priority: 'high',
        title: 'Negative Cash Flow',
        message: `We're losing $${Math.abs(city.budget.monthlyBalance)} per month.`,
      });
    }

    return messages;
  }
}
```

---

### Data Overlay Rendering

Add to `MainScene.ts` for visualization:

```typescript
// MainScene.ts additions

private dataOverlay: 'none' | 'zones' | 'traffic' | 'landValue' | 'crime' = 'none';
private overlayGraphics: Phaser.GameObjects.Graphics | null = null;

setDataOverlay(overlay: typeof this.dataOverlay) {
  this.dataOverlay = overlay;
  this.renderDataOverlay();
}

private renderDataOverlay() {
  if (this.overlayGraphics) {
    this.overlayGraphics.destroy();
  }

  if (this.dataOverlay === 'none') return;

  this.overlayGraphics = this.add.graphics();
  this.overlayGraphics.setDepth(0.01);  // Just above ground tiles
  this.overlayGraphics.setAlpha(0.5);

  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const color = this.getOverlayColor(x, y);
      if (color !== null) {
        const screenPos = this.gridToScreen(x, y);
        this.overlayGraphics.fillStyle(color);
        // Draw isometric tile shape
        this.drawIsoTile(this.overlayGraphics, screenPos.x, screenPos.y);
      }
    }
  }
}

private getOverlayColor(x: number, y: number): number | null {
  switch (this.dataOverlay) {
    case 'zones':
      const zone = this.grid[y][x].zone;
      if (!zone) return null;
      return { R: 0x00ff00, C: 0x0000ff, I: 0xffff00 }[zone.type];

    case 'traffic':
      const traffic = this.simGrid.cells[y][x].traffic;
      return lerpColor(0x00ff00, 0xff0000, traffic / 100);

    case 'landValue':
      const value = this.simGrid.cells[y][x].landValue;
      return lerpColor(0xff0000, 0x00ff00, value / 100);

    case 'crime':
      const crime = this.simGrid.cells[y][x].crime;
      return lerpColor(0x00ff00, 0xff0000, crime / 100);

    default:
      return null;
  }
}
```

---

### Save/Load Structure

```typescript
// app/data/SaveManager.ts

interface SaveGame {
  version: number;  // For migration
  timestamp: number;

  // Core state
  grid: SerializedGrid;
  gameTime: GameTime;
  budget: Budget;

  // Simulation state (some recomputed on load)
  demand: { r: number; c: number; i: number };
  population: number;
  happiness: number;

  // History for graphs
  history: {
    population: number[];
    budget: number[];
    happiness: number[];
  };

  // Active events
  activeEvents: GameEvent[];

  // Settings
  settings: GameSettings;
}

// Compress grid for smaller saves
interface SerializedGrid {
  width: number;
  height: number;
  // RLE or sparse encoding for tiles
  tiles: string;  // Encoded tile data
  buildings: SerializedBuilding[];
}
```

---

*This is a living document - update as development progresses!*
