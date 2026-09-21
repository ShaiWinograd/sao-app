'use client';

import { useAuth } from '@clerk/nextjs';
import { CheckCircle2, MapPin } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, authHeaders } from '../../lib/api';

export type AddressSelection = {
  token: string;
  displayAddress: string;
  city: string | null;
  precision: string;
  exact: true;
};

type AzureMapsSuggestion = {
  token: string;
  displayAddress: string;
  city: string | null;
  precision: string;
  exact: boolean;
};

type GeocodeSuggestResponse = {
  available: boolean;
  candidates: AzureMapsSuggestion[];
  reason?: string;
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
  const { getToken } = useAuth();
  const [suggestions, setSuggestions] = useState<AzureMapsSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [serviceState, setServiceState] = useState<'ready' | 'unavailable' | 'error'>('ready');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selectedDisplay, setSelectedDisplay] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canSearch = value.trim().length >= 3 && value !== selectedDisplay;

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!canSearch) {
      setSuggestions([]);
      setIsOpen(false);
      setIsLoading(false);
      setHasSearched(false);
      setServiceState('ready');
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      setHasSearched(false);
      try {
        const auth = await authHeaders(getToken);
        const response = await api.post<GeocodeSuggestResponse>(
          '/geocode/suggest',
          { q: value.trim() },
          { ...auth, signal: controller.signal },
        );
        if (!response.data.available) {
          setSuggestions([]);
          setIsOpen(false);
          setServiceState('unavailable');
          return;
        }

        setSuggestions(response.data.candidates);
        setActiveIndex(-1);
        setIsOpen(response.data.candidates.length > 0);
        setServiceState('ready');
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setIsOpen(false);
          setServiceState('error');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setHasSearched(true);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [canSearch, getToken, value]);

  const statusText = useMemo(() => {
    if (isLoading) return 'מחפש כתובות מאומתות...';
    if (value.trim().length > 0 && value.trim().length < 3) return 'הקלידי לפחות 3 תווים לחיפוש.';
    if (serviceState === 'unavailable') return 'חיפוש הכתובות אינו מוגדר כרגע. אפשר לאשר שמירה ידנית ללא ניטור מיקום.';
    if (serviceState === 'error') return 'לא ניתן לחפש כתובות כרגע. נסי שוב או אשרי שמירה ידנית.';
    if (hasSearched && suggestions.length === 0) return 'לא נמצאה כתובת מתאימה. נסי להוסיף רחוב, מספר ועיר.';
    return '';
  }, [hasSearched, isLoading, serviceState, suggestions.length, value]);

  const selectSuggestion = (suggestion: AzureMapsSuggestion) => {
    if (!suggestion.exact) return;
    onChange(suggestion.displayAddress);
    onSelectionChange?.({
      token: suggestion.token,
      displayAddress: suggestion.displayAddress,
      city: suggestion.city,
      precision: suggestion.precision,
      exact: true,
    });
    setSelectedDisplay(suggestion.displayAddress);
    setSuggestions([]);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          onSelectionChange?.(null);
          setSelectedDisplay(null);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setIsOpen(true);
        }}
        onKeyDown={(event) => {
          if (!isOpen || suggestions.length === 0) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((previous) => (previous + 1) % suggestions.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((previous) => (previous <= 0 ? suggestions.length - 1 : previous - 1));
          } else if (event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            selectSuggestion(suggestions[activeIndex]);
          } else if (event.key === 'Escape') {
            setIsOpen(false);
          }
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {isOpen && suggestions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.token}
              type="button"
              onClick={() => selectSuggestion(suggestion)}
              disabled={!suggestion.exact}
              className={`flex w-full items-center justify-between gap-3 border-b border-[var(--color-border)] px-3 py-2.5 text-right text-sm last:border-b-0 ${
                index === activeIndex ? 'bg-primary-50 text-primary-900' : 'text-gray-800 hover:bg-primary-50/50'
              } disabled:cursor-not-allowed disabled:text-gray-400`}
            >
              <span>
                <span className="block">{suggestion.displayAddress}</span>
                {!suggestion.exact && <span className="mt-0.5 block text-[11px]">נדרשים רחוב, מספר ועיר מדויקים</span>}
              </span>
              {suggestion.exact ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <MapPin className="h-4 w-4 shrink-0" />}
            </button>
          ))}
        </div>
      )}
      {statusText && <p className="mt-1 text-[11px] text-amber-700">{statusText}</p>}
    </div>
  );
}
