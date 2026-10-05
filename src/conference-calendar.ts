/**
 * General Conference calendar facts shared by the scraper, feed generator
 * and feed health check.
 */

/**
 * General Conference is held on the first full weekend: the first Saturday
 * of April/October, returned as 00:00 UTC that day.
 */
export function conferenceSaturday(year: number, month: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (6 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset));
}
