'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type AddressSelection = {
  displayAddress: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  providerPlaceId: string;
  validationStatus: 'Confirmed';
};

type AzureMapsSuggestion = {
  id: string;
  displayAddress: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
};

type AzureMapsAddressInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (selection: AddressSelection | null) => void;
  placeholder?: string;
  className?: string;
};

export default function AzureMapsAddressInput({
  value,
  onChange,
  onSelectionChange,
  placeholder,
  className,
}: AzureMapsAddressInputProps) {
  const [suggestions, setSuggestions] = useState<AzureMapsSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const apiKey = process.env.NEXT_PUBLIC_AZURE_MAPS_KEY;
  const baseUrl = (process.env.NEXT_PUBLIC_AZURE_MAPS_BASE_URL ?? 'https://atlas.microsoft.com').replace(/\/+$/, '');
  const canSearch = Boolean(apiKey && value.trim().length >= 3);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!canSearch) {
      setSuggestions([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const url = new URL(`${baseUrl}/search/address/json`);
        url.searchParams.set('api-version', '1.0');
        url.searchParams.set('subscription-key', apiKey ?? '');
        url.searchParams.set('language', 'he-IL');
        url.searchParams.set('countrySet', 'IL');
        url.searchParams.set('limit', '6');
        url.searchParams.set('typeahead', 'true');
        url.searchParams.set('query', value.trim());

        const response = await fetch(url.toString(), { signal: controller.signal });
        if (!response.ok) {
          throw new Error('Azure Maps search failed');
        }
        const payload = await response.json();
        const nextSuggestions: AzureMapsSuggestion[] = Array.isArray(payload?.results)
          ? payload.results
              .filter((item: any) => item?.address?.freeformAddress && item?.position)
              .map((item: any) => ({
                id: String(item.id ?? item.position?.lat ?? Math.random()),
                displayAddress: String(item.address.freeformAddress),
                formattedAddress: String(item.address.freeformAddress),
                latitude: Number(item.position.lat),
                longitude: Number(item.position.lon),
              }))
          : [];

        setSuggestions(nextSuggestions);
        setActiveIndex(-1);
        setIsOpen(nextSuggestions.length > 0);
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setIsOpen(false);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [apiKey, canSearch, value]);

  const statusText = useMemo(() => {
    if (!apiKey) {
      return 'כדי לאפשר חיפוש כתובות, הגדירי NEXT_PUBLIC_AZURE_MAPS_KEY.';
    }
    if (isLoading) return 'מחפש כתובות...';
    if (value.trim().length > 0 && value.trim().length < 3) return 'הקלידי לפחות 3 תווים לחיפוש.';
    return '';
  }, [apiKey, isLoading, value]);

  const selectSuggestion = (suggestion: AzureMapsSuggestion) => {
    onChange(suggestion.displayAddress);
    onSelectionChange?.({
      displayAddress: suggestion.displayAddress,
      formattedAddress: suggestion.formattedAddress,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      providerPlaceId: suggestion.id,
      validationStatus: 'Confirmed',
    });
    setSuggestions([]);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onSelectionChange?.(null);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setIsOpen(true);
        }}
        onKeyDown={(e) => {
          if (!isOpen || suggestions.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((prev) => (prev + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
          } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            selectSuggestion(suggestions[activeIndex]);
          } else if (e.key === 'Escape') {
            setIsOpen(false);
          }
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              type="button"
              onClick={() => selectSuggestion(suggestion)}
              className={`w-full px-3 py-2 text-right text-sm border-b last:border-b-0 ${
                index === activeIndex ? 'bg-primary-50 text-primary-900' : 'hover:bg-gray-50 text-gray-800'
              }`}
            >
              {suggestion.displayAddress}
            </button>
          ))}
        </div>
      )}
      {statusText && <p className="mt-1 text-[11px] text-amber-700">{statusText}</p>}
    </div>
  );
}
