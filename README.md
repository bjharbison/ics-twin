# ICS Twin: Grid Substation and Water Treatment

Two browser-based digital twins of small industrial control systems (ICS): a **12.47 kV distribution substation feeder** and a **municipal water-treatment plant**. Each twin models a plant's normal operation, couples its telemetry tags to a single driving factor so the data behave like a real process rather than independent noise, and renders the result in two views: a 2.5D isometric one-line and a 3D yard.

> **See it in 30 seconds:** open [`twin/grid_twin.html`](twin/grid_twin.html) or [`twin/water_twin.html`](twin/water_twin.html) in a browser. Each runs a built-in simulator; no hardware, server, or install is required.

## The grid substation twin

Eleven telemetry tags (three-phase voltage and current, frequency, power factor, real power, transformer temperature, and breaker status) all ride one slow-moving **load factor**. As load rises, voltage sags, current rises, and the transformer heats along a first-order integrator, the same coupling the field firmware uses.

The operator panel supports a planned **switching operation**: opening the breaker de-energizes the feeder, so current and real power fall to zero while the bus stays energized and the transformer cools.

Beyond the simulator, the twin can also read live telemetry, read-only, from any MQTT-over-WebSocket broker that publishes the documented `grid/<tag>` topics, or replay historical points from a CSV.

## The water treatment twin

Four process tags (`naoh_ppm`, `flow_rate`, `tank_level`, and `pump_state`) plus a derived `pressure` indicator all ride one **district demand** factor. The intake pump balances district draw to hold the storage tank in band, and caustic (NaOH) dosing tracks flow to hold roughly 100 ppm.

Taking the pump out of service shows the process dynamics an operator has to manage: district draw continues, so the tank drains, flow and dosing fall, and the low-tank, under-dose, and low-pressure alarms fire. The water twin is simulator-only, and its tag ranges are a target specification.

## Design choices

- **One driving factor per plant.** Every tag derives from a single latent variable (load or demand), so the telemetry stays physically coherent.
- **Firmware as ground truth.** The grid twin's simulator is a line-for-line port of the field-device firmware, so the simulated and live data share one model.
- **Read-only by design.** Live mode only subscribes; the twin never publishes commands to a broker.
- **Self-contained.** Each twin is a single HTML file plus a small shared 3D helper (`twin/lib/twin3d-kit.js`); three.js loads from a CDN.

## Repository layout

```
twin/
├── grid_twin.html      grid substation twin (sim, live MQTT, CSV replay)
├── water_twin.html     water treatment twin (sim)
└── lib/twin3d-kit.js   shared 3D scaffolding for both twins
```

## License

MIT; see [LICENSE](LICENSE).
