/*
 * iLab Moon — ESP32 Mission Console (one KY-023 joystick)
 *
 * DOIT ESP32 DEVKIT V1 wiring:
 *   GPIO35 → VRy   push up/down = throttle
 *   GPIO34 → VRx   left/right  = rotate
 *   GPIO32 → SW    press stick = full thrust
 *   3V3    → +
 *   GND    → G
 *
 * Do NOT use GPIO12, GPIO15, or GPIO0 — boot strapping pins.
 *
 * Libraries: WebSockets by Markus Sattler (links2004)
 * Board:     ESP32 Dev Module
 */

#include <WiFi.h>
#include <WebSocketsServer.h>

const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

const int PIN_JOY_X  = 34;   // rotate
const int PIN_JOY_Y  = 35;   // throttle
const int PIN_JOY_SW = 32;   // full thrust
const int PIN_LED    = 2;

const int DEADZONE       = 500;
const int SEND_MS        = 50;
const int CAL_SAMPLES    = 64;
const int WIFI_TIMEOUT_MS = 30000;

int centerX = 2048;
int centerY = 2048;

WebSocketsServer webSocket(81);

void calibrateJoystick() {
  long sumX = 0, sumY = 0;
  for (int i = 0; i < CAL_SAMPLES; i++) {
    sumX += analogRead(PIN_JOY_X);
    sumY += analogRead(PIN_JOY_Y);
    delay(5);
    yield();
  }
  centerX = sumX / CAL_SAMPLES;
  centerY = sumY / CAL_SAMPLES;
  Serial.printf("Centre X=%d  Y=%d\n", centerX, centerY);
}

float mapAxis(int raw, int centre) {
  int v = raw - centre;
  if (abs(v) < DEADZONE) return 0.0f;
  float n = (float)(abs(v) - DEADZONE) / (float)(2048 - DEADZONE);
  return constrain(n, 0.0f, 1.0f) * (v > 0 ? 1.0f : -1.0f);
}

float readThrottle() {
  if (digitalRead(PIN_JOY_SW) == LOW) return 1.0f;
  int v = centerY - analogRead(PIN_JOY_Y);
  if (v < DEADZONE) return 0.0f;
  return constrain((float)(v - DEADZONE) / (float)(2048 - DEADZONE), 0.0f, 1.0f);
}

float readRotate() {
  return mapAxis(analogRead(PIN_JOY_X), centerX);
}

void broadcastState() {
  char buf[64];
  snprintf(buf, sizeof(buf), "{\"thrust\":%.2f,\"rotate\":%.2f}",
    readThrottle(), readRotate());
  webSocket.broadcastTXT(buf);
}

bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > (unsigned long)WIFI_TIMEOUT_MS) {
      Serial.println("\nWiFi timeout");
      return false;
    }
    digitalWrite(PIN_LED, !digitalRead(PIN_LED));
    delay(250);
    Serial.print(".");
    yield();
  }
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(PIN_JOY_SW, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
  analogSetAttenuation(ADC_11db);

  Serial.println("\n================================");
  Serial.println(" iLab Moon — ESP32 Mission Console");
  Serial.println(" One stick: up=throttle, L/R=rotate");
  Serial.println("================================");
  Serial.println("Centre the stick — calibrating in 2 s...");
  delay(2000);
  calibrateJoystick();

  if (!connectWiFi()) { delay(5000); ESP.restart(); }

  digitalWrite(PIN_LED, HIGH);
  Serial.println("\n────────────────────────────────");
  Serial.print("Mission Console IP: ");
  Serial.println(WiFi.localIP());
  Serial.println("────────────────────────────────");

  webSocket.begin();
  webSocket.onEvent([](uint8_t num, WStype_t type, uint8_t*, size_t) {
    if (type == WStype_CONNECTED) broadcastState();
  });
}

unsigned long lastSend = 0;

void loop() {
  webSocket.loop();
  yield();
  if (millis() - lastSend >= (unsigned long)SEND_MS) {
    lastSend = millis();
    broadcastState();
  }
}
