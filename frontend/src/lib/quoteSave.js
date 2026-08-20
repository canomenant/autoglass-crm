import { updateQuote } from "./api";
import { money } from "@/components/OrderSummaryUI";

// A quote always wins over its work order, even one that's already Paid or Closed — historical
// figures get corrected in bulk and the quote is the single place to correct them. But the server
// won't reprice a collected job silently: it answers 409 and writes nothing until the caller comes
// back with confirmPriceChange.
//
// Both screens that can edit a quote route through here so the prompt, the figures and the retry
// are identical wherever the save started. Returns null when the user declines — callers must
// treat that as "nothing was saved" rather than falling through to a success message.
export async function updateQuoteConfirmingPaidWorkOrder(id, data, { tQuotes, tWorkOrders }) {
  try {
    return await updateQuote(id, data);
  } catch (err) {
    if (!err.details?.requiresConfirmation) throw err;

    const message = tQuotes("paidWorkOrderPriceChange", {
      workOrderNo: err.details.workOrderNo,
      status: tWorkOrders(`statuses.${err.details.workOrderStatus}`),
      oldPrice: money(err.details.oldPrice),
      newPrice: money(err.details.newPrice),
    });
    if (!window.confirm(message)) return null;

    return updateQuote(id, { ...data, confirmPriceChange: true });
  }
}
