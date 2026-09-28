/** Throws: a service a spell needed is missing. */
export const missing = (what: string): never => {
  throw new TypeError(`A spell needs ${what}.`);
};
