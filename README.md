#Moon Day Simulation

An interactive **lunar landing simulation** for **Moon Day** celebrations at iLab. Experience a powered descent under real lunar gravity (**g = 1.62 m/s²**), rendered in WebGL via Three.js.

This is an educational simulator — not an arcade game. Participants practice the same challenges Apollo crews faced: managing thrust, attitude, and drift in a vacuum with one-sixth Earth gravity.

## Controls

| Key | Action |
|-----|--------|
| `↑` / `W` / `Space` | Main engine thrust |
| `←` / `A` | RCS rotate left |
| `→` / `D` | RCS rotate right |

## Objective

Execute a **soft, steady touchdown** anywhere on the lunar surface:

- Vertical speed ≤ **4.0 m/s**
- Horizontal drift ≤ **2.8 m/s**
- Tilt ≤ **22°** from upright

On touchdown you receive a **landing assessment** (Nominal → Unsafe) and telemetry readout — descent rate, drift, attitude, and fuel remaining.

## Flight systems

Use the **Flight Systems** panel (top-right) or presets:

| System | Guided demo (on) | Full simulation (off) |
|--------|------------------|------------------------|
| **Attitude Stabilizer** | Auto-levels when not rotating | Manual RCS only |
| **Auto Guidance** | Dampens sideways drift | Full inertial drift |
| **Descent Control** | Auto-throttle below 280 m | Pilot controls thrust |

- **Guided Demo** — all systems on, gentler approach (good for classrooms & first-timers)
- **Full Simulation** — Apollo-era manual flight, no automation

## Visual features

- Three.js WebGL renderer with ACES tone mapping
- Procedural crater-field moon terrain with normal map
- Hard lunar shadows (no atmosphere)
- Bloom post-processing on engine plume
- Apollo LM-style lander with antennas, RCS, and engine flame
- Earth in the sky with day/night terminator
- Starfield, terrain map, synthesized engine audio

## DIY Mission Console (ESP32 + joystick)

Optional physical console for Moon Day booths — one **KY-023** joystick: up = throttle, left/right = rotate.

Wiring & upload: [`docs/CONTROLLER.md`](docs/CONTROLLER.md)

## Run

```bash
npx serve .
```

Open http://localhost:3000
