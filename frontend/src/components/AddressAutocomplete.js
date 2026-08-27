"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { loadGoogleMaps } from "@/lib/googleMaps";

// short: Google devuelve cada componente en dos formas, y para el estado importa cuál. longText da
// "California"; el <select> del formulario sólo acepta ["CA", "TX"], así que con el nombre largo
// no coincidía ninguna opción y el estado se quedaba vacío después de elegir la dirección.
function extractComponent(components, type, short = false) {
  const c = components.find((x) => x.types.includes(type));
  if (!c) return "";
  return (short ? c.shortText || c.longText : c.longText) || "";
}

const inputClassName =
  "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:cursor-not-allowed";

// PlaceAutocompleteElement (google.maps.places, replaces the deprecated
// google.maps.places.Autocomplete widget — not available to new Cloud projects as of March
// 2025) is a web component with its own internal input living in a shadow root: it has no
// settable "current value" prop and its shadow root can't be reached from outside to show an
// already-picked address when re-opening a saved record. So this IS the primary, full-width
// address field (not a small assist box above a separate plain input, which made it too easy to
// type past it and skip city/state/zip capture entirely) — searching and picking a suggestion
// fires onPlaceSelected same as before; a small "type manually" toggle underneath is the
// deliberate secondary path for when the widget can't find an address, not an equally-prominent
// shortcut. If the widget itself fails to load (no key / script error), this falls back to plain
// manual entry automatically, same as before.
export default function AddressAutocomplete({ label, value, onChange, onPlaceSelected, placeholder, required, disabled }) {
  const t = useTranslations("common");
  const containerRef = useRef(null);
  const [widgetReady, setWidgetReady] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  // onChange/onPlaceSelected are inline arrow functions in every caller, so they're a new
  // reference on every render — mount the widget once (empty deps below) and always call
  // through these refs instead, so appending the element to the DOM isn't repeated on every
  // keystroke elsewhere in the form.
  const onChangeRef = useRef(onChange);
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  onChangeRef.current = onChange;
  onPlaceSelectedRef.current = onPlaceSelected;

  useEffect(() => {
    let cancelled = false;
    let element = null;
    let handleSelect = null;

    loadGoogleMaps()
      .then(async (maps) => {
        if (cancelled || !containerRef.current) return;
        const { PlaceAutocompleteElement } = await maps.importLibrary("places");
        element = new PlaceAutocompleteElement({
          includedRegionCodes: ["us"],
        });
        element.style.width = "100%";
        containerRef.current.appendChild(element);
        setWidgetReady(true);

        handleSelect = async (event) => {
          try {
            const place = await event.detail.placePrediction.toPlace();
            await place.fetchFields({ fields: ["formattedAddress", "addressComponents", "location"] });
            const components = place.addressComponents || [];
            const data = {
              formattedAddress: place.formattedAddress || "",
              streetNumber: extractComponent(components, "street_number"),
              route: extractComponent(components, "route"),
              city: extractComponent(components, "locality"),
              state: extractComponent(components, "administrative_area_level_1", true),
              postalCode: extractComponent(components, "postal_code"),
              country: extractComponent(components, "country", true),
              lat: place.location ? place.location.lat() : null,
              lng: place.location ? place.location.lng() : null,
            };
            onChangeRef.current(data.formattedAddress);
            onPlaceSelectedRef.current?.(data);
          } catch {
            // Selection failed to resolve — leave the plain input as-is, user can type manually.
          }
        };
        element.addEventListener("gmp-select", handleSelect);
      })
      .catch(() => {
        // No API key configured, or the script failed to load — fail open into manual mode, so
        // the field is never just blank/unusable.
        if (!cancelled) setManualMode(true);
      });

    return () => {
      cancelled = true;
      if (element && handleSelect) element.removeEventListener("gmp-select", handleSelect);
      element?.remove();
    };
  }, []);

  const showWidget = widgetReady && !manualMode;
  const showManualInput = manualMode || !widgetReady;

  return (
    <div>
      {label && <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{label}{required && <span className="text-red-500"> *</span>}</label>}

      <div ref={containerRef} className={showWidget ? "" : "hidden"} />

      {showManualInput && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          className={inputClassName}
        />
      )}

      {showWidget && value && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">{value}</p>
      )}

      {widgetReady && (
        <button
          type="button"
          onClick={() => setManualMode((m) => !m)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
        >
          {manualMode ? t("searchAddressInstead") : t("typeAddressManually")}
        </button>
      )}
    </div>
  );
}
