import { availablePaymentMethods } from "../donations";

// Run as a fresh subprocess (see donations.test.ts's "availablePaymentMethods
// gates QRIS" describe): donations.ts binds every Sumopod variable into
// module-level consts at import time, so the only way to exercise a given
// configuration is to start a process that has it.
console.log(JSON.stringify(availablePaymentMethods()));
