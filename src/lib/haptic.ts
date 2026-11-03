// Kurzes Antippen-Feedback. Android: Vibration. iPhone (Safari ab iOS 18): ein unsichtbarer
// System-Schalter wird umgelegt – das löst die eingebaute Haptik aus (Web-Apps haben sonst keinen Zugriff).
export function haptic() {
  try {
    if (typeof navigator.vibrate === "function" && navigator.vibrate(10)) return;
  } catch {
    /* weiter mit dem iOS-Weg */
  }
  try {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.appendChild(input);
    document.body.appendChild(label);
    label.click();
    label.remove();
  } catch {
    /* ohne Haptik weiter */
  }
}
