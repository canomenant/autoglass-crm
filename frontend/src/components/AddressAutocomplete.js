"use client";

import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "@/lib/googleMaps";

function extractComponent(components, type) {
  return components.find((c) => c.types.includes(type))?.longText || "";
}

// PlaceAutocompleteElement (google.maps.places, replaces the deprecated
// google.maps.places.Autocomplete widget — not available to new Cloud projects as of March
// 2025) is a web component with its own internal input living in a shadow root, not a
// controlled <input> — it has no settable "current value" the way a normal input does. So this
// renders it as a separate search-assist box above the real controlled <input>: searching and
// picking a suggestion fills the plain input (via onChange) same as if the user had typed it,
// but the plain input keeps working exactly as before if the widget fails to load or the user
// just wants to type/edit the address by hand.
export default function AddressAutocomplete({ label, value, onChange, onPlaceSelected, placeholder, required, disabled }) {
  const containerRef = useRef(null);
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
        containerRef.current.appendChild(element);

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
              state: extractComponent(components, "administrative_area_level_1"),
              postalCode: extractComponent(components, "postal_code"),
              country: extractComponent(components, "country"),
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
        // No API key configured, or the script failed to load — fail open. The plain input
        // below still works for manual entry, so this isn't fatal to the form.
      });

    return () => {
      cancelled = true;
      if (element && handleSelect) element.removeEventListener("gmp-select", handleSelect);
      element?.remove();
    };
  }, []);

  return (
    <div>
      {label && <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{label}{required && <span className="text-red-500"> *</span>}</label>}
      <div ref={containerRef} className="mb-1.5 empty:mb-0 [&:not(:empty)]:border [&:not(:empty)]:border-dashed [&:not(:empty)]:border-blue-200 dark:[&:not(:empty)]:border-blue-500/30 [&:not(:empty)]:rounded-lg [&:not(:empty)]:p-1" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:cursor-not-allowed"
      />
    </div>
  );
}
