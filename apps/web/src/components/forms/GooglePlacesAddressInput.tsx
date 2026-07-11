'use client';

import { useEffect, useRef } from 'react';

type GooglePlacesAddressInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

type GoogleMapsWindow = Window & {
  __googleMapsPlacesPromise?: Promise<void>;
  google?: any;
};

const GOOGLE_MAPS_SCRIPT_ID = 'google-maps-places-script';

function loadGooglePlacesScript(apiKey: string) {
  const w = window as GoogleMapsWindow;
  if (w.google?.maps?.places) {
    return Promise.resolve();
  }
  if (w.__googleMapsPlacesPromise) {
    return w.__googleMapsPlacesPromise;
  }
  w.__googleMapsPlacesPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Maps script')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&language=he&region=IL`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps script'));
    document.head.appendChild(script);
  });

  return w.__googleMapsPlacesPromise;
}

export default function GooglePlacesAddressInput({
  value,
  onChange,
  placeholder,
  className,
}: GooglePlacesAddressInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<any>(null);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey || !inputRef.current) return;

    let isMounted = true;
    loadGooglePlacesScript(apiKey)
      .then(() => {
        if (!isMounted || !inputRef.current) return;
        const googleObj = (window as GoogleMapsWindow).google;
        if (!googleObj?.maps?.places) return;
        autocompleteRef.current = new googleObj.maps.places.Autocomplete(inputRef.current, {
          fields: ['formatted_address', 'place_id', 'geometry'],
          componentRestrictions: { country: 'il' },
          types: ['address'],
        });
        autocompleteRef.current.addListener('place_changed', () => {
          const place = autocompleteRef.current?.getPlace?.();
          const formattedAddress = place?.formatted_address;
          if (formattedAddress) {
            onChange(formattedAddress);
          }
        });
      })
      .catch(() => {
        // Keep manual input available if Google script fails.
      });

    return () => {
      isMounted = false;
    };
  }, [onChange]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      autoComplete="street-address"
    />
  );
}
