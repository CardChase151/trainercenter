# Charging a vendor table fee

How money actually moves at Trainer Center, and the one way it is allowed to.

## The rule

**A card is only ever charged from a browser signed in as Chase.** Never from
SQL, never from the Supabase MCP, never from a script holding a service key.
Writing `payment_status = 'charged'` in the database marks a vendor as paid
without any money moving. Stripe never hears about it, the vendor is never
billed, and the books are wrong until somebody notices. The button is the only
thing that both charges the card and records it.

## The flow, end to end

1. Vendor applies for a date. Row appears with `status = pending`,
   `payment_status = card_pending`.
2. Vendor saves a card. `payment_status = card_saved`. **Nothing is charged yet.**
3. Chase opens `/staff/vendors`, finds the application, clicks
   **Approve &amp; collect**, confirms the amount.
4. The button calls the `stripe-vendor-payment` edge function, action `charge`,
   which runs the card off-session on the connected account. Only then does the
   row become `payment_status = charged` with a `charged_amount_cents`, a
   `stripe_payment_intent_id` and Stripe's own `receipt_url`.
5. Approving the date also approves the vendor. There is no separate profile
   approval step, and there has not been one since 09.26.2026.

Amounts: staff may charge anything from 0 up to the fee the vendor agreed to.
0 records a waive. Less than the fee is a discount. Above it is refused server
side, because the vendor never consented to more.

## Rates

The event carries both prices. `table_fee_cents` is the first-timer rate and
`table_fee_returning_cents` is the returning rate.

**Returning means they have paid for a table at an earlier event.** It is
decided by `vendor_is_returning(vendor_id)`, which both the apply page and the
express fast-pass call, so the two cannot quote different numbers. It used to
key off door check-ins, which meant a vendor who paid and was never scanned in
got quoted the first-timer rate again. Chase changed it 09.26.2026.

For the 10.25.2026 event that is **$100, or $75 returning**.

## If the card declines

The charge returns a decline rather than throwing. Send a hosted pay link from
the same screen (`create_pay_link`), which bills the same capped amount and
marks the row paid when they complete it.

## Refunds and releases

- **Refund** a charged application from the same screen. It reverses the
  payment intent and sets `payment_status = refunded`.
- **Declining** an application releases the saved card automatically. Nothing
  was charged, so the card is detached at Stripe and cleared from the row. That
  is `release_card`, and it runs on decline, cancel, not-interested and
  vendor-cancelled.

## Driving it from a terminal session

Claude cannot click the button on Chase's behalf without a browser already
signed in as him. Copying the Chrome profile is refused, and rightly so, since
it holds his cookies and saved logins.

Two ways that do work:

1. **Claude in Chrome extension.** When it is connected, Claude drives the
   session already open. This is the normal path. If it reports "extension is
   not connected", reconnect it and try again.
2. **Attach to the running Chrome over the debugging port.** Chase starts
   Chrome himself with the port open, then Claude connects to that session
   rather than making its own:

   ```
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --remote-debugging-port=9222
   ```

   Then Playwright attaches with `chromium.connectOverCDP('http://localhost:9222')`.
   The session is his, the login is his, and no credential file is ever copied.

Either way, **Claude states the vendor, the amount and the card before
clicking**, and does not batch several charges without saying so first.
