// One-off: clears payments.json back to [] so the new batch-settlement payments model
// (workOrderIds array, Pending/Ready For Payment/Approved/Paid/Cancelled lifecycle) can be
// exercised fresh against the 58 test Work Orders, instead of the 58 old single-WO payments
// created under the previous model. Run with the backend stopped.
const { save } = require("../src/lib/persistence");

save("payments.json", []);
console.log("payments.json reset to [].");
