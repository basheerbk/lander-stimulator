# DIY Mission Console (ESP32 + 1 Joystick)

**One KY-023 joystick is enough.** It has two axes and a button — that covers all lander controls.

## Controls (one stick)

| Input | Action |
|-------|--------|
| Push stick **up** | Throttle |
| Push stick **left / right** | Rotate |
| **Press** stick | Full thrust |

## Wiring (DOIT ESP32 DEVKIT V1)

| ESP32 pin | Joystick pin |
|-----------|--------------|
| **GPIO35** | **VRy** (throttle) |
| **GPIO34** | **VRx** (rotate) |
| **GPIO32** | **SW** (full thrust) |
| **3V3** | **+** |
| **GND** | **G** |

```
        KY-023                    ESP32
         VRy ─────────────────── GPIO35
         VRx ─────────────────── GPIO34
         SW  ─────────────────── GPIO32
         +   ─────────────────── 3V3
         G   ─────────────────── GND
```

## Pins to avoid

| Pin | Reason |
|-----|--------|
| GPIO12, GPIO15, GPIO0 | Boot strapping — causes upload/boot failures |

## Arduino IDE (DOIT ESP32 DEVKIT V1)

| Setting | Value |
|---------|--------|
| Board | ESP32 Dev Module |
| Upload Speed | 115200 |
| Flash Size | 4MB |
| Serial Monitor | 115200 baud |

Upload: hold **BOOT** if needed. If boot loop: **Erase Flash** → re-upload.

## Two joysticks?

Not required. Two sticks only help if you want separate physical controls (e.g. one student on throttle, one on attitude). For a single student, **one joystick is simpler and cheaper**.

Firmware: [`firmware/ilab_moon_console/ilab_moon_console.ino`](../firmware/ilab_moon_console/ilab_moon_console.ino)
