// System-wide constants shared across API, web, and mobile.

// The permanent "General Reservation" system customer (spec §3.2). Used to
// reserve workforce before a real customer exists. Cannot be deleted. Seeded
// with this fixed id so all layers can reference it deterministically.
export const GENERAL_RESERVATION_CUSTOMER_ID = 'general-reservation';

// Hebrew display name: שריון כללי
export const GENERAL_RESERVATION_FIRST_NAME = 'שריון';
export const GENERAL_RESERVATION_LAST_NAME = 'כללי';
