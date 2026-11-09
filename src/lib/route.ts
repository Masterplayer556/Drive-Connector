import { useEffect, useState } from "react";

export type RouteName = "drive" | "konten" | "protokoll" | "mehr" | "einrichtung" | "duplikate" | "papierkorb" | "favoriten" | "statistik" | "links" | "regal" | "design" | "pruefung" | "platz";

export interface Route {
  name: RouteName;
  params: URLSearchParams;
}

const NAMES: RouteName[] = ["drive", "konten", "protokoll", "mehr", "einrichtung", "duplikate", "papierkorb", "favoriten", "statistik", "links", "regal", "design", "pruefung", "platz"];

function parse(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = hash.split("?");
  const name = (NAMES as string[]).includes(path) ? (path as RouteName) : "drive";
  return { name, params: new URLSearchParams(query) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(name: RouteName, params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params)}` : "";
  window.location.hash = `#/${name}${q}`;
}

/** Parameter aus der URL entfernen, ohne neu zu navigieren. */
export function clearParams(name: RouteName) {
  history.replaceState(null, "", `${window.location.pathname}#/${name}`);
}
