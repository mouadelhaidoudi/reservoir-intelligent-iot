import mqtt from "mqtt";

const topic = "iotcloud/2026/groupe_chafi/projet/device01/telemetry";
const marker = `smoke-${Date.now()}`;
const payload = JSON.stringify({
  deviceId: marker,
  timestamp: new Date().toISOString(),
  measurements: {
    niveau: 42.5,
    distance: 227.5,
    hauteur: 127.5,
    volumeEauActuelle: 425,
    tempsRemplissageEstime: 23
  },
  actuators: {
    relay: false,
    pompe: false,
    puissancePompe: 100,
    debit: 0,
    angleServo: 90,
    vanneOuverture: 90
  }
});

const client = mqtt.connect(process.env.MQTT_URL || "mqtt://broker.hivemq.com:1883");
client.on("connect", () => {
  client.publish(topic, payload, { qos: 1 }, (error) => {
    if (error) throw error;
    console.log(marker);
    client.end();
  });
});
client.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
  client.end(true);
});
