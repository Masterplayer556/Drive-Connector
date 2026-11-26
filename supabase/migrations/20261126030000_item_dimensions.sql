-- Bildmasse aus Google Drive (imageMediaMetadata.width/height) – damit lassen sich Screenshots auch ohne
-- „Screenshot“ im Namen erkennen (z. B. IMG_1234.PNG mit 1170×2532 vom iPhone). Bestehende Einträge
-- bekommen die Werte beim nächsten Abgleich, der sie verändert, oder beim kompletten Neu-Einlesen.
alter table public.items add column if not exists width integer;
alter table public.items add column if not exists height integer;
