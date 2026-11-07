#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>   // ArduinoJson version 6.x
#include <time.h>
#include <math.h>

// =========================================================
// WIFI
// =========================================================
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASSWORD = "";

// =========================================================
// MQTT
// =========================================================
const char* MQTT_BROKER = "broker.hivemq.com";
const int MQTT_PORT = 1883;
const char* MQTT_CLIENT_ID = "esp32-01";
const char* DEVICE_ID = "esp32-01";

// =========================================================
// TOPICS
// =========================================================
const char* TOPIC_TELEMETRY = "iotcloud/2026/groupe_chafi/projet/device01/telemetry";
const char* TOPIC_STATUS    = "iotcloud/2026/groupe_chafi/projet/device01/status";
const char* TOPIC_ALERT     = "iotcloud/2026/groupe_chafi/projet/device01/alert";
const char* TOPIC_COMMAND   = "iotcloud/2026/groupe_chafi/projet/device01/command";
const char* TOPIC_ACK       = "iotcloud/2026/groupe_chafi/projet/device01/ack";

// =========================================================
// OBJETS
// =========================================================
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
LiquidCrystal_I2C lcd(0x27, 16, 2);
Servo servoVanne;

// =========================================================
// PINS
// =========================================================
#define PIN_TRIG   5
#define PIN_ECHO   18
#define LED_ROUGE  27
#define LED_ORANGE 26
#define LED_VERTE  25
#define PIN_POMPE  14
#define BUZZER     32
#define BTN_RESET  17
#define PIN_POT    34
#define PIN_RELAIS 33
#define PIN_SERVO  13

// =========================================================
// RESERVOIR
// =========================================================
const float DISTANCE_VIDE = 400.0;
const float DISTANCE_PLEIN = 100.0;
const float HAUTEUR_RESERVOIR = 300.0;

// =========================================================
// POMPE / DEBIT
// =========================================================
const float DEBIT_MAX = 25.0;
float debitCommande = 25.0;
float debitActuel = 0.0;
int puissancePompe = 100;
int angleServo = 90;

const float DEBITS_AUTORISES[] = {5.0, 10.0, 15.0, 20.0, 25.0};

// =========================================================
// VOLUME / TEMPS
// =========================================================
const float CAPACITE_RESERVOIR_LITRES = 1000.0;
float volumeEauActuelle = 0.0;
float tempsRemplissageEstime = 0.0;

// =========================================================
// ETAT
// =========================================================
float derniereMesureHC = DISTANCE_VIDE;
float distanceSimulation = DISTANCE_VIDE;
float niveauPourcentage = 0.0;
float hauteurEau = 0.0;
bool pompeActive = false;
bool alerteFuite = false;

// =========================================================
// DETECTION FUITE
// =========================================================
const float SEUIL_NOUVELLE_MESURE = 3.0;
const float SEUIL_FUITE = 20.0;

// =========================================================
// SEUILS LED
// =========================================================
const float SEUIL_LED_BAS_DEFAUT = 20.0;
const float SEUIL_LED_HAUT_DEFAUT = 60.0;
float seuilLedBas = SEUIL_LED_BAS_DEFAUT;
float seuilLedHaut = SEUIL_LED_HAUT_DEFAUT;

// =========================================================
// TIMING
// =========================================================
const unsigned long INTERVALLE_BOUCLE = 100;
const unsigned long INTERVALLE_LCD = 500;
const unsigned long INTERVALLE_MQTT = 500;
const unsigned long DEBOUNCE = 250;

unsigned long dernierTempsSimulation = 0;
unsigned long dernierTempsLCD = 0;
unsigned long dernierTempsMQTT = 0;
unsigned long dernierTempsBoucle = 0;
unsigned long dernierTempsBouton = 0;
unsigned long dernierTempsAlarme = 0;

bool boutonOccupe = false;
bool etatClignotementAlarme = false;

// =========================================================
// NTP
// =========================================================
const long GMT_OFFSET_SEC = 0;
const int DAYLIGHT_OFFSET_SEC = 0;

// =========================================================
// AJOUT : PROTECTION RECONNEXION
// =========================================================
unsigned long dernierEssaiMQTT = 0;
const unsigned long INTERVALLE_RECONNEXION_MQTT = 5000;

// =========================================================
// AJOUT : ANTI-DOUBLE DETECTION FUITE
// =========================================================
unsigned long dernierTempsDetectionFuite = 0;
const unsigned long DELAI_DETECTION_FUITE = 1000;

// =========================================================
// PROTOTYPES
// =========================================================
void connexionWiFi();
void reconnexionMQTT();
void messageMQTT(char* topic, byte* payload, unsigned int length);
void publierJSONMQTT(const char* topic, JsonDocument& doc);
void publierACK(const String& commandId, const String& status, const String& message);
void publierAlerteFuite(const String& message);
String obtenirTimestamp();
float lireDistanceHC();
float calculerNiveau(float distance);
float calculerHauteur(float niveau);
void calculerVolumeEtTemps();
bool debitAutorise(float nouveauDebit);
void appliquerCommandeDebit(float nouveauDebit);
void verifierChangementHC();
void simulerRemplissage();
void gererBoutonReset();
void gererAlarmes();
void publierMQTT();
void afficherLCD();

// =========================================================
// TIMESTAMP
// =========================================================
String obtenirTimestamp() {
    time_t maintenant = time(nullptr);
    struct tm tempsUTC;
    gmtime_r(&maintenant, &tempsUTC);

    char buffer[30];
    strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &tempsUTC);
    return String(buffer);
}

// =========================================================
// WIFI
// =========================================================
void connexionWiFi() {
    Serial.print("Connexion WiFi... ");

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }

    Serial.println("OK");
    Serial.print("IP : ");
    Serial.println(WiFi.localIP());
}

// =========================================================
// MQTT
// =========================================================
void reconnexionMQTT() {

    if (WiFi.status() != WL_CONNECTED) {
        return;
    }

    if (mqttClient.connected()) {
        return;
    }

    if (millis() - dernierEssaiMQTT < INTERVALLE_RECONNEXION_MQTT) {
        return;
    }

    dernierEssaiMQTT = millis();

    Serial.print("Connexion MQTT... ");

    String clientId = String(MQTT_CLIENT_ID) + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);

    if (mqttClient.connect(clientId.c_str())) {
        Serial.println("OK");

        mqttClient.subscribe(TOPIC_COMMAND);

        Serial.print("Souscription : ");
        Serial.println(TOPIC_COMMAND);

    } else {
        Serial.print("Echec code=");
        Serial.println(mqttClient.state());
    }
}

// =========================================================
// PUBLICATION JSON
// =========================================================
void publierJSONMQTT(const char* topic, JsonDocument& doc) {

    if (!mqttClient.connected()) {
        Serial.println("[MQTT] Non connecte");
        return;
    }

    char buffer[2048];

    size_t taille = serializeJson(doc, buffer, sizeof(buffer));

    if (taille == 0) {
        Serial.println("[MQTT] Erreur serialization JSON");
        return;
    }

    Serial.println();
    Serial.println("========================================");
    Serial.println("MQTT ENVOI");
    Serial.print("Topic : ");
    Serial.println(topic);
    Serial.print("Payload : ");
    Serial.println(buffer);

    bool resultat = mqttClient.publish(topic, buffer);

    Serial.print("Resultat : ");
    Serial.println(resultat ? "OK" : "ECHEC");

    Serial.println("========================================");
}

// =========================================================
// ACK
// =========================================================
void publierACK(
    const String& commandId,
    const String& status,
    const String& message
) {

    if (!mqttClient.connected()) {
        Serial.println("[ACK] MQTT non connecte");
        return;
    }

    StaticJsonDocument<512> doc;

    doc["commandId"] = commandId;
    doc["deviceId"] = DEVICE_ID;
    doc["status"] = status;
    doc["message"] = message;
    doc["timestamp"] = obtenirTimestamp();

    publierJSONMQTT(TOPIC_ACK, doc);
}

// =========================================================
// ALERTE FUITE
// =========================================================
void publierAlerteFuite(const String& message) {

    if (!mqttClient.connected()) {
        return;
    }

    StaticJsonDocument<512> doc;

    doc["deviceId"] = DEVICE_ID;
    doc["timestamp"] = obtenirTimestamp();
    doc["type"] = "FUITE";
    doc["status"] = "ACTIVE";
    doc["message"] = message;

    JsonObject measurements = doc.createNestedObject("measurements");

    measurements["niveau"] = niveauPourcentage;
    measurements["distance"] = distanceSimulation;

    publierJSONMQTT(TOPIC_ALERT, doc);
}

// =========================================================
// VERIFICATION DEBIT
// =========================================================
bool debitAutorise(float nouveauDebit) {

    for (
        size_t i = 0;
        i < sizeof(DEBITS_AUTORISES) / sizeof(DEBITS_AUTORISES[0]);
        i++
    ) {
        if (fabs(nouveauDebit - DEBITS_AUTORISES[i]) < 0.001) {
            return true;
        }
    }

    return false;
}

// =========================================================
// MESSAGE MQTT
// =========================================================
void messageMQTT(
    char* topic,
    byte* payload,
    unsigned int length
) {

    String message = "";

    for (unsigned int i = 0; i < length; i++) {
        message += (char)payload[i];
    }

    Serial.println();
    Serial.println("========================================");
    Serial.println("MQTT MESSAGE RECU");
    Serial.print("Topic : ");
    Serial.println(topic);
    Serial.print("Payload : ");
    Serial.println(message);
    Serial.println("========================================");

    if (String(topic) != TOPIC_COMMAND) {
        return;
    }

    StaticJsonDocument<512> doc;

    DeserializationError erreur =
        deserializeJson(doc, message);

    if (erreur) {
        Serial.print("Erreur JSON : ");
        Serial.println(erreur.c_str());
        return;
    }

    String commandId = doc["commandId"] | "";
    String commande = doc["command"] | "";

    if (commandId == "") {
        Serial.println("Commande ignoree : commandId manquant");
        return;
    }

    // =====================================================
    // PUMP_ON
    // =====================================================
    if (commande == "PUMP_ON") {

        if (alerteFuite) {

            pompeActive = false;
            debitActuel = 0.0;

            Serial.println(">>> POMPE REFUSEE : FUITE ACTIVE");

            publierACK(
                commandId,
                "ERROR",
                "Impossible d'activer la pompe : fuite active"
            );

            return;
        }

        if (niveauPourcentage >= 100.0) {

            pompeActive = false;
            debitActuel = 0.0;

            Serial.println(">>> POMPE REFUSEE : RESERVOIR PLEIN");

            publierACK(
                commandId,
                "ERROR",
                "Impossible d'activer la pompe : reservoir plein"
            );

            return;
        }

        pompeActive = true;
        dernierTempsSimulation = millis();
        debitActuel = debitCommande;

        Serial.println(">>> POMPE ON");

        publierACK(
            commandId,
            "SUCCESS",
            "Pompe activee"
        );

        return;
    }

    // =====================================================
    // PUMP_OFF
    // =====================================================
    if (commande == "PUMP_OFF") {

        pompeActive = false;
        debitActuel = 0.0;

        Serial.println(">>> POMPE OFF");

        publierACK(
            commandId,
            "SUCCESS",
            "Pompe arretee"
        );

        return;
    }

    // =====================================================
    // RESET_FUITE
    // =====================================================
    if (commande == "RESET_FUITE") {

        Serial.println(">>> RESET FUITE RECU PAR MQTT");

        alerteFuite = false;

        noTone(BUZZER);

        etatClignotementAlarme = false;

        float nouvelleMesureHC = lireDistanceHC();

        derniereMesureHC = nouvelleMesureHC;
        distanceSimulation = nouvelleMesureHC;

        niveauPourcentage =
            calculerNiveau(distanceSimulation);

        hauteurEau =
            calculerHauteur(niveauPourcentage);

        calculerVolumeEtTemps();

        Serial.println(">>> FUITE DESACTIVEE");

        publierACK(
            commandId,
            "SUCCESS",
            "Fuite reset depuis MQTT"
        );

        return;
    }

    // =====================================================
    // SET_DEBIT
    // =====================================================
    if (commande == "SET_DEBIT") {

        if (!doc.containsKey("value")) {

            Serial.println(">>> VALEUR DEBIT MANQUANTE");

            publierACK(
                commandId,
                "ERROR",
                "Valeur du debit manquante"
            );

            return;
        }

        float nouveauDebit =
            doc["value"].as<float>();

        if (!debitAutorise(nouveauDebit)) {

            Serial.println(">>> DEBIT REFUSE");

            publierACK(
                commandId,
                "ERROR",
                "Debit non autorise"
            );

            return;
        }

        appliquerCommandeDebit(nouveauDebit);

        Serial.print(">>> DEBIT MODIFIE : ");
        Serial.println(debitCommande);

        String messageACK =
            "Debit configure a " +
            String(debitCommande, 1) +
            " cm/s ; puissance pompe = " +
            String(puissancePompe) +
            "% ; angle servo = " +
            String(angleServo) +
            " deg";

        publierACK(
            commandId,
            "SUCCESS",
            messageACK
        );

        return;
    }

    // =====================================================
    // SET_SEUILS
    // =====================================================
    if (commande == "SET_SEUILS") {

        if (
            !doc.containsKey("seuilBas") ||
            !doc.containsKey("seuilHaut")
        ) {

            Serial.println(">>> SEUILS MANQUANTS");

            publierACK(
                commandId,
                "ERROR",
                "Seuils manquants (seuilBas et seuilHaut requis)"
            );

            return;
        }

        float nouveauBas =
            doc["seuilBas"].as<float>();

        float nouveauHaut =
            doc["seuilHaut"].as<float>();

        if (
            nouveauBas < 0.0 ||
            nouveauHaut > 100.0 ||
            nouveauBas >= nouveauHaut
        ) {

            Serial.println(">>> SEUILS REFUSES");

            publierACK(
                commandId,
                "ERROR",
                "Seuils invalides : il faut 0 <= seuilBas < seuilHaut <= 100"
            );

            return;
        }

        seuilLedBas = nouveauBas;
        seuilLedHaut = nouveauHaut;

        Serial.print(">>> SEUILS LED MODIFIES : bas=");
        Serial.print(seuilLedBas);
        Serial.print(" haut=");
        Serial.println(seuilLedHaut);

        String messageACK =
            "Seuils LED configures : rouge < " +
            String(seuilLedBas, 1) +
            "% ; orange " +
            String(seuilLedBas, 1) +
            "-" +
            String(seuilLedHaut, 1) +
            "% ; verte > " +
            String(seuilLedHaut, 1) +
            "%";

        publierACK(
            commandId,
            "SUCCESS",
            messageACK
        );

        return;
    }

    // =====================================================
    // RESET_SEUILS
    // =====================================================
    if (commande == "RESET_SEUILS") {

        seuilLedBas =
            SEUIL_LED_BAS_DEFAUT;

        seuilLedHaut =
            SEUIL_LED_HAUT_DEFAUT;

        Serial.println(">>> SEUILS LED PAR DEFAUT");

        String messageACK =
            "Seuils LED remis par defaut : rouge < " +
            String(seuilLedBas, 1) +
            "% ; orange " +
            String(seuilLedBas, 1) +
            "-" +
            String(seuilLedHaut, 1) +
            "% ; verte > " +
            String(seuilLedHaut, 1) +
            "%";

        publierACK(
            commandId,
            "SUCCESS",
            messageACK
        );

        return;
    }

    // =====================================================
    // SET_HC_INITIAL  (AJOUT)
    // =====================================================
    if (commande == "SET_HC_INITIAL") {

        if (!doc.containsKey("value")) {

            Serial.println(">>> VALEUR HC MANQUANTE");

            publierACK(
                commandId,
                "ERROR",
                "Valeur HC manquante"
            );

            return;
        }

        float nouvelleDistance =
            doc["value"].as<float>();

        if (
            nouvelleDistance < DISTANCE_PLEIN ||
            nouvelleDistance > DISTANCE_VIDE
        ) {

            Serial.println(">>> HC INITIAL REFUSE");

            publierACK(
                commandId,
                "ERROR",
                "Distance invalide : il faut 100 <= valeur <= 400 cm"
            );

            return;
        }

        // On memorise la vraie lecture du capteur comme reference :
        // verifierChangementHC() ne l'ecrasera pas tant que le capteur ne bouge pas
        derniereMesureHC = lireDistanceHC();

        // On force la distance simulee
        distanceSimulation = nouvelleDistance;

        niveauPourcentage =
            calculerNiveau(distanceSimulation);

        hauteurEau =
            calculerHauteur(niveauPourcentage);

        calculerVolumeEtTemps();

        Serial.print(">>> HC INITIAL = ");
        Serial.println(nouvelleDistance);

        publierACK(
            commandId,
            "SUCCESS",
            "Distance initiale configuree a " +
            String(nouvelleDistance, 1) +
            " cm"
        );

        return;
    }

    // =====================================================
    // INCONNUE
    // =====================================================
    publierACK(
        commandId,
        "ERROR",
        "Commande inconnue"
    );
}

// =========================================================
// HC-SR04
// =========================================================
float lireDistanceHC() {

    digitalWrite(PIN_TRIG, LOW);

    delayMicroseconds(2);

    digitalWrite(PIN_TRIG, HIGH);

    delayMicroseconds(10);

    digitalWrite(PIN_TRIG, LOW);

    unsigned long dureeEcho =
        pulseIn(PIN_ECHO, HIGH, 30000);

    if (dureeEcho == 0) {
        return derniereMesureHC;
    }

    float distance =
        dureeEcho / 58.0;

    if (distance < DISTANCE_PLEIN) {
        distance = DISTANCE_PLEIN;
    }

    if (distance > DISTANCE_VIDE) {
        distance = DISTANCE_VIDE;
    }

    return distance;
}

// =========================================================
// CALCUL NIVEAU
// =========================================================
float calculerNiveau(float distance) {

    float niveau =
        (
            (DISTANCE_VIDE - distance) /
            (DISTANCE_VIDE - DISTANCE_PLEIN)
        ) * 100.0;

    niveau =
        constrain(niveau, 0.0, 100.0);

    return niveau;
}

// =========================================================
// CALCUL HAUTEUR
// =========================================================
float calculerHauteur(float niveau) {

    return
        (niveau / 100.0) *
        HAUTEUR_RESERVOIR;
}

// =========================================================
// VOLUME + TEMPS
// =========================================================
void calculerVolumeEtTemps() {

    volumeEauActuelle =
        (niveauPourcentage / 100.0) *
        CAPACITE_RESERVOIR_LITRES;

    float distanceRestante =
        distanceSimulation -
        DISTANCE_PLEIN;

    if (distanceRestante < 0.0) {
        distanceRestante = 0.0;
    }

    if (
        debitActuel > 0.0 &&
        distanceRestante > 0.0 &&
        niveauPourcentage < 100.0
    ) {

        tempsRemplissageEstime =
            distanceRestante /
            debitActuel;

    } else {

        tempsRemplissageEstime = 0.0;
    }

    if (niveauPourcentage >= 100.0) {
        tempsRemplissageEstime = 0.0;
    }
}

// =========================================================
// APPLICATION DEBIT
// =========================================================
void appliquerCommandeDebit(float nouveauDebit) {

    if (!debitAutorise(nouveauDebit)) {

        Serial.println("Debit invalide");

        return;
    }

    debitCommande =
        nouveauDebit;

    puissancePompe =
        (debitCommande / DEBIT_MAX) * 100.0;

    angleServo =
        (puissancePompe / 100.0) * 90.0;

    servoVanne.write(angleServo);

    if (pompeActive) {
        debitActuel =
            debitCommande;
    }

    Serial.println();
    Serial.println("===== COMMANDE DEBIT =====");

    Serial.print("Debit commande : ");
    Serial.print(debitCommande);
    Serial.println(" cm/s");

    Serial.print("Puissance pompe : ");
    Serial.print(puissancePompe);
    Serial.println(" %");

    Serial.print("Angle servo : ");
    Serial.print(angleServo);
    Serial.println(" deg");
}

// =========================================================
// VERIFICATION CHANGEMENT HC
// =========================================================
void verifierChangementHC() {

    float nouvelleMesure =
        lireDistanceHC();

    float difference =
        fabs(
            nouvelleMesure -
            derniereMesureHC
        );

    if (difference < SEUIL_NOUVELLE_MESURE) {
        return;
    }

    float ancienNiveau =
        calculerNiveau(distanceSimulation);

    distanceSimulation =
        nouvelleMesure;

    derniereMesureHC =
        nouvelleMesure;

    niveauPourcentage =
        calculerNiveau(
            distanceSimulation
        );

    hauteurEau =
        calculerHauteur(
            niveauPourcentage
        );

    float diminution =
        ancienNiveau -
        niveauPourcentage;

    if (
        diminution >= SEUIL_FUITE &&
        millis() - dernierTempsDetectionFuite >=
        DELAI_DETECTION_FUITE
    ) {

        dernierTempsDetectionFuite =
            millis();

        if (!alerteFuite) {

            alerteFuite = true;

            pompeActive = false;

            debitActuel = 0.0;

            Serial.println();
            Serial.println(">>> FUITE DETECTEE");

            publierAlerteFuite(
                "Fuite detectee par variation du HC-SR04"
            );
        }
    }
}

// =========================================================
// SIMULATION REMPLISSAGE
// =========================================================
void simulerRemplissage() {

    if (!pompeActive) {

        debitActuel = 0.0;

        return;
    }

    if (alerteFuite) {

        debitActuel = 0.0;

        return;
    }

    if (
        distanceSimulation <=
        DISTANCE_PLEIN
    ) {

        distanceSimulation =
            DISTANCE_PLEIN;

        niveauPourcentage =
            100.0;

        hauteurEau =
            HAUTEUR_RESERVOIR;

        debitActuel =
            0.0;

        pompeActive =
            false;

        Serial.println();
        Serial.println(">>> RESERVOIR PLEIN");

        return;
    }

    unsigned long maintenant =
        millis();

    float dt =
        (maintenant -
         dernierTempsSimulation) /
        1000.0;

    dernierTempsSimulation =
        maintenant;

    debitActuel =
        debitCommande;

    distanceSimulation -=
        debitActuel * dt;

    if (
        distanceSimulation <=
        DISTANCE_PLEIN
    ) {

        distanceSimulation =
            DISTANCE_PLEIN;

        niveauPourcentage =
            100.0;

        hauteurEau =
            HAUTEUR_RESERVOIR;

        debitActuel =
            0.0;

        pompeActive =
            false;

    } else {

        niveauPourcentage =
            calculerNiveau(
                distanceSimulation
            );

        hauteurEau =
            calculerHauteur(
                niveauPourcentage
            );
    }
}

// =========================================================
// BOUTON UNIQUE
// =========================================================
void gererBoutonReset() {

    bool appuye =
        (digitalRead(BTN_RESET) == LOW);

    if (!appuye) {

        boutonOccupe = false;

        return;
    }

    if (boutonOccupe) {
        return;
    }

    if (
        millis() -
        dernierTempsBouton <
        DEBOUNCE
    ) {
        return;
    }

    dernierTempsBouton =
        millis();

    boutonOccupe = true;

    // =====================================================
    // FUITE ACTIVE -> RESET
    // =====================================================
    if (alerteFuite) {

        alerteFuite = false;

        noTone(BUZZER);

        etatClignotementAlarme = false;

        float nouvelleMesureHC =
            lireDistanceHC();

        derniereMesureHC =
            nouvelleMesureHC;

        distanceSimulation =
            nouvelleMesureHC;

        niveauPourcentage =
            calculerNiveau(
                distanceSimulation
            );

        hauteurEau =
            calculerHauteur(
                niveauPourcentage
            );

        Serial.println();
        Serial.println("================================");
        Serial.println(">>> RESET FUITE");
        Serial.println(">>> FUITE DESACTIVEE");
        Serial.println("================================");

        String commandIdPhysique =
            "cmd-btn-reset-" +
            String(millis());

        publierACK(
            commandIdPhysique,
            "SUCCESS",
            "Fuite reset par bouton physique"
        );

        return;
    }

    // =====================================================
    // PAS DE FUITE -> SIMULATION
    // =====================================================
    alerteFuite = true;

    pompeActive = false;

    debitActuel = 0.0;

    Serial.println();
    Serial.println("================================");
    Serial.println(">>> FUITE SIMULEE");
    Serial.println(">>> POMPE ARRETEE");
    Serial.println("================================");

    publierAlerteFuite(
        "Fuite simulee par bouton physique"
    );

    String commandIdPhysique =
        "cmd-btn-fuite-" +
        String(millis());

    publierACK(
        commandIdPhysique,
        "SUCCESS",
        "Fuite simulee par bouton physique"
    );
}

// =========================================================
// ALARMES
// =========================================================
void gererAlarmes() {

    if (alerteFuite) {

        digitalWrite(
            LED_VERTE,
            LOW
        );

        if (
            millis() -
            dernierTempsAlarme >=
            200
        ) {

            dernierTempsAlarme =
                millis();

            etatClignotementAlarme =
                !etatClignotementAlarme;
        }

        digitalWrite(
            LED_ROUGE,
            etatClignotementAlarme
        );

        digitalWrite(
            LED_ORANGE,
            !etatClignotementAlarme
        );

        tone(
            BUZZER,
            1800
        );

        digitalWrite(
            PIN_RELAIS,
            LOW
        );

        digitalWrite(
            PIN_POMPE,
            LOW
        );

        return;
    }

    digitalWrite(
        LED_ROUGE,
        LOW
    );

    digitalWrite(
        LED_ORANGE,
        LOW
    );

    digitalWrite(
        LED_VERTE,
        LOW
    );

    noTone(BUZZER);

    if (
        niveauPourcentage <
        seuilLedBas
    ) {

        digitalWrite(
            LED_ROUGE,
            HIGH
        );

        tone(
            BUZZER,
            600
        );

    } else if (
        niveauPourcentage <=
        seuilLedHaut
    ) {

        digitalWrite(
            LED_ORANGE,
            HIGH
        );

    } else {

        digitalWrite(
            LED_VERTE,
            HIGH
        );
    }

    digitalWrite(
        PIN_RELAIS,
        pompeActive ?
        HIGH :
        LOW
    );

    digitalWrite(
        PIN_POMPE,
        pompeActive ?
        HIGH :
        LOW
    );
}

// =========================================================
// MQTT TELEMETRY + STATUS
// =========================================================
void publierMQTT() {

    if (!mqttClient.connected()) {
        return;
    }

    calculerVolumeEtTemps();

    // =====================================================
    // TELEMETRY
    // =====================================================
    StaticJsonDocument<1536> telemetry;

    telemetry["deviceId"] =
        DEVICE_ID;

    telemetry["timestamp"] =
        obtenirTimestamp();

    JsonObject measurements =
        telemetry.createNestedObject(
            "measurements"
        );

    measurements["niveau"] =
        niveauPourcentage;

    measurements["distance"] =
        distanceSimulation;

    measurements["hauteur"] =
        hauteurEau;

    measurements["volumeEauActuelle"] =
        volumeEauActuelle;

    measurements["tempsRemplissageEstime"] =
        tempsRemplissageEstime;

    JsonObject actuators =
        telemetry.createNestedObject(
            "actuators"
        );

    actuators["relay"] =
        pompeActive;

    actuators["pompe"] =
        pompeActive;

    actuators["puissancePompe"] =
        puissancePompe;

    actuators["debit"] =
        debitActuel;

    actuators["angleServo"] =
        angleServo;

    actuators["vanneOuverture"] =
        angleServo;

    publierJSONMQTT(
        TOPIC_TELEMETRY,
        telemetry
    );

    // =====================================================
    // STATUS
    // =====================================================
    StaticJsonDocument<768> status;

    status["deviceId"] =
        DEVICE_ID;

    status["timestamp"] =
        obtenirTimestamp();

    status["pompe"] =
        pompeActive ?
        "ON" :
        "OFF";

    status["relais"] =
        pompeActive ?
        "ON" :
        "OFF";

    status["fuite"] =
        alerteFuite ?
        "ACTIVE" :
        "NON";

    if (alerteFuite) {

        status["systeme"] =
            "FUITE";

    } else if (pompeActive) {

        status["systeme"] =
            "POMPE_ACTIVE";

    } else {

        status["systeme"] =
            "NORMAL";
    }

    publierJSONMQTT(
        TOPIC_STATUS,
        status
    );
}

// =========================================================
// LCD
// =========================================================
void afficherLCD() {

    lcd.clear();

    lcd.setCursor(0, 0);

    lcd.print("Niv:");
    lcd.print(
        (int)niveauPourcentage
    );
    lcd.print("%");

    lcd.setCursor(0, 1);

    if (alerteFuite) {

        lcd.print("!! FUITE !!");

    } else if (pompeActive) {

        lcd.print("P:");
        lcd.print(puissancePompe);

        lcd.print("% D:");
        lcd.print(
            debitActuel,
            1
        );

    } else {

        lcd.print("Pompe OFF");
    }
}

// =========================================================
// SETUP
// =========================================================
void setup() {

    Serial.begin(115200);

    delay(1000);

    Serial.println();
    Serial.println("========================================");
    Serial.println("     RESERVOIR INTELLIGENT ESP32");
    Serial.println("========================================");

    // =====================================================
    // PINS
    // =====================================================
    pinMode(
        PIN_TRIG,
        OUTPUT
    );

    pinMode(
        PIN_ECHO,
        INPUT
    );

    pinMode(
        LED_ROUGE,
        OUTPUT
    );

    pinMode(
        LED_ORANGE,
        OUTPUT
    );

    pinMode(
        LED_VERTE,
        OUTPUT
    );

    pinMode(
        PIN_POMPE,
        OUTPUT
    );

    pinMode(
        PIN_RELAIS,
        OUTPUT
    );

    pinMode(
        BUZZER,
        OUTPUT
    );

    pinMode(
        BTN_RESET,
        INPUT_PULLUP
    );

    pinMode(
        PIN_POT,
        INPUT
    );

    // =====================================================
    // ETAT INITIAL
    // =====================================================
    digitalWrite(
        LED_ROUGE,
        LOW
    );

    digitalWrite(
        LED_ORANGE,
        LOW
    );

    digitalWrite(
        LED_VERTE,
        LOW
    );

    digitalWrite(
        PIN_POMPE,
        LOW
    );

    digitalWrite(
        PIN_RELAIS,
        LOW
    );

    // =====================================================
    // LCD
    // =====================================================
    Wire.begin();

    lcd.init();

    lcd.backlight();

    lcd.clear();

    lcd.setCursor(0, 0);
    lcd.print("Reservoir");

    lcd.setCursor(0, 1);
    lcd.print("Initialisation");

    // =====================================================
    // SERVO
    // =====================================================
    servoVanne.attach(PIN_SERVO);

    Serial.println(
        "[INIT] Servo / vanne OK"
    );

    // =====================================================
    // DEBIT INITIAL
    // =====================================================
    appliquerCommandeDebit(25.0);

    // =====================================================
    // HC INITIAL
    // =====================================================
    float mesureInitiale =
        lireDistanceHC();

    derniereMesureHC =
        mesureInitiale;

    distanceSimulation =
        mesureInitiale;

    niveauPourcentage =
        calculerNiveau(
            distanceSimulation
        );

    hauteurEau =
        calculerHauteur(
            niveauPourcentage
        );

    calculerVolumeEtTemps();

    Serial.print(
        "[INIT] Distance HC : "
    );

    Serial.print(
        mesureInitiale
    );

    Serial.println(
        " cm"
    );

    // =====================================================
    // WIFI
    // =====================================================
    connexionWiFi();

    // =====================================================
    // NTP
    // =====================================================
    configTime(
        GMT_OFFSET_SEC,
        DAYLIGHT_OFFSET_SEC,
        "pool.ntp.org"
    );

    // =====================================================
    // MQTT
    // =====================================================
    mqttClient.setServer(
        MQTT_BROKER,
        MQTT_PORT
    );

    mqttClient.setCallback(
        messageMQTT
    );

    mqttClient.setBufferSize(
        2048
    );

    // =====================================================
    // AJOUT : KEEP ALIVE MQTT
    // =====================================================
    mqttClient.setKeepAlive(30);

    reconnexionMQTT();

    // =====================================================
    // TIMERS
    // =====================================================
    dernierTempsSimulation =
        millis();

    dernierTempsLCD =
        millis();

    dernierTempsMQTT =
        millis();

    dernierTempsBoucle =
        millis();

    dernierTempsBouton =
        millis();

    dernierTempsAlarme =
        millis();

    dernierEssaiMQTT =
        millis();

    dernierTempsDetectionFuite =
        millis();

    boutonOccupe =
        false;

    Serial.println();
    Serial.println("========================================");
    Serial.println("SYSTEME PRET");
    Serial.println("========================================");
}

// =========================================================
// LOOP
// =========================================================
void loop() {

    // =====================================================
    // BOUTON
    // =====================================================
    gererBoutonReset();

    // =====================================================
    // WIFI
    // =====================================================
    if (WiFi.status() != WL_CONNECTED) {

        connexionWiFi();
    }

    // =====================================================
    // MQTT
    // =====================================================
    if (!mqttClient.connected()) {

        reconnexionMQTT();

    } else {

        mqttClient.loop();
    }

    unsigned long maintenant =
        millis();

    // =====================================================
    // BOUCLE PRINCIPALE
    // =====================================================
    if (
        maintenant -
        dernierTempsBoucle >=
        INTERVALLE_BOUCLE
    ) {

        dernierTempsBoucle =
            maintenant;

        verifierChangementHC();

        simulerRemplissage();

        // =================================================
        // AUTO START
        // =================================================
        if (!alerteFuite) {

            if (
                niveauPourcentage < 20.0 &&
                !pompeActive
            ) {

                pompeActive = true;

                dernierTempsSimulation =
                    millis();

                debitActuel =
                    debitCommande;
            }

        } else {

            pompeActive =
                false;
        }

        // =================================================
        // PLEIN
        // =================================================
        if (
            niveauPourcentage >=
            100.0
        ) {

            niveauPourcentage =
                100.0;

            distanceSimulation =
                DISTANCE_PLEIN;

            hauteurEau =
                HAUTEUR_RESERVOIR;

            pompeActive =
                false;

            debitActuel =
                0.0;
        }

        gererAlarmes();
    }

    // =====================================================
    // LCD
    // =====================================================
    if (
        maintenant -
        dernierTempsLCD >=
        INTERVALLE_LCD
    ) {

        dernierTempsLCD =
            maintenant;

        afficherLCD();
    }

    // =====================================================
    // MQTT
    // =====================================================
    if (
        maintenant -
        dernierTempsMQTT >=
        INTERVALLE_MQTT
    ) {

        dernierTempsMQTT =
            maintenant;

        publierMQTT();
    }
}