/**
 * Wetter des Berichtstags (7–17 Uhr) über Open-Meteo, Ort per PLZ (Zippopotam) oder Name.
 * Logik aus V46 übernommen: Temperatur = Mittelwert, Kästchen aus WMO-Codes, Wind ab 35 km/h,
 * Frost ab 0 °C, Sonne bei mindestens der Hälfte klarer Stunden.
 */
import { toDayKey, type WeatherFlags } from '../../../shared/contract';

interface Location {
    name: string;
    latitude: number;
    longitude: number;
    country_code: string;
}

export interface WeatherResult {
    temperatur: string;
    flags: WeatherFlags;
    placeName: string;
}

async function findLocation(place: string): Promise<Location> {
    const query = place.trim();
    let locations: Location[] = [];
    if (/^\d{5}$/.test(query)) {
        const response = await fetch(`https://api.zippopotam.us/de/${encodeURIComponent(query)}`);
        if (response.status === 404) throw new Error('Deutsche Postleitzahl nicht gefunden.');
        if (!response.ok) throw new Error('Die PLZ-Suche ist nicht erreichbar.');
        const entry = (await response.json()) as { places?: Record<string, string>[] };
        locations = (entry.places ?? []).map((p) => ({
            name: p['place name'] ?? query,
            latitude: Number(p.latitude),
            longitude: Number(p.longitude),
            country_code: 'DE',
        }));
    } else {
        const response = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=30&countryCode=DE&language=de&format=json`,
        );
        if (!response.ok) throw new Error('Die Ortssuche ist nicht erreichbar.');
        locations = ((await response.json()) as { results?: Location[] }).results ?? [];
    }
    const german = locations.find((l) => l.country_code === 'DE');
    if (!german) throw new Error('Ort nicht gefunden. Bitte PLZ oder Ort mit Bundesland versuchen.');
    return german;
}

export async function fetchWeather(place: string, day: string): Promise<WeatherResult> {
    const location = await findLocation(place);
    const today = toDayKey(new Date());
    if (day > today) throw new Error('Für zukünftige Tage gibt es noch keine gemessenen Wetterdaten.');
    const host = day < today ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const url = `${host}?latitude=${location.latitude}&longitude=${location.longitude}&start_date=${day}&end_date=${day}&hourly=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Der Wetterdienst ist nicht erreichbar (${response.status}).`);
    const json = (await response.json()) as {
        hourly?: { time: string[]; temperature_2m: (number | null)[]; weather_code?: (number | null)[]; wind_speed_10m?: (number | null)[] };
    };
    const h = json.hourly;
    if (!h?.time || !h.temperature_2m) throw new Error('Für dieses Datum sind keine Wetterdaten verfügbar.');
    const samples = h.time
        .map((time, i) => ({
            hour: Number(time.slice(11, 13)),
            temp: Number(h.temperature_2m[i]),
            code: Number(h.weather_code?.[i]),
            wind: Number(h.wind_speed_10m?.[i]),
        }))
        .filter((s) => s.hour >= 7 && s.hour <= 17 && Number.isFinite(s.temp));
    if (samples.length === 0) throw new Error('Keine Wetterdaten zwischen 7 und 17 Uhr verfügbar.');
    const avg = samples.reduce((sum, s) => sum + s.temp, 0) / samples.length;
    const sunny = samples.filter((s) => s.code === 0 || s.code === 1).length;
    return {
        temperatur: `${Math.round(avg)} °C`,
        placeName: location.name,
        flags: {
            regen: samples.some((s) => (s.code >= 51 && s.code <= 67) || (s.code >= 80 && s.code <= 82) || (s.code >= 95 && s.code <= 99)),
            schnee: samples.some((s) => (s.code >= 71 && s.code <= 77) || (s.code >= 85 && s.code <= 86)),
            frost: samples.some((s) => s.temp <= 0),
            wind: samples.some((s) => Number.isFinite(s.wind) && s.wind >= 35),
            sonne: sunny >= Math.ceil(samples.length / 2),
        },
    };
}
