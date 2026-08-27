/**
 * Money, from minor units to something a person reads.
 *
 * Everything in this system stores money as an integer number of minor units
 * — paise, cents — because a payslip that disagrees with itself by a rounding
 * error is a payslip somebody has to argue about.
 *
 * No currency symbol. The company's currency lives on the company record, and
 * the screens that show money say which one; guessing here would put a rupee
 * sign on a dollar figure.
 */
export function formatMinor(minor: number | null, fractionDigits = 2): string {
  if (minor === null) return "—";
  return (minor / 100).toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}
