export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}

/**
 * Development/test default: logs the code instead of sending a real SMS.
 * A real vendor (Twilio, or a local Indonesian SMS gateway) implements this
 * same interface once one is chosen — this mirrors the master design doc's
 * PaymentProvider adapter pattern (Midtrans/Xendit/Sumopod behind one
 * interface), applied to SMS delivery instead of payments.
 */
export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phone: string, code: string): Promise<void> {
    console.log(`[dev SMS] OTP for ${phone}: ${code}`);
  }
}
