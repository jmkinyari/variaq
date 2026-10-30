# Tax sample files — Demo Supplies Ltd, April 2026

Fictional data (own KRA PIN `P051234567X`) for practising the VAT reconciliation. Upload each file in
**Data hub** with period `2026-04`; the dataset type is detected automatically.

| File | Dataset |
|---|---|
| `erp-sales-register-2026-04.csv` | ERP sales register |
| `SEC_B_WITH_VAT_PIN1.csv` | iTax / eTIMS sales (VAT3 Section B layout) |
| `erp-purchase-register-2026-04.csv` | ERP purchase register |
| `SEC_F_WITH_VAT_PIN1.csv` | iTax / eTIMS purchases (VAT3 Section F layout) |
| `whvat-certificates-2026-04.csv` | Withholding VAT certificates |

Then run **Tax → VAT reconciliation** for April 2026. The data deliberately produces every status:
matches found by each of the four matching passes, amount / VAT / PIN / period mismatches, ERP
invoices missing from eTIMS (sales and purchases), eTIMS invoices missing from the ERP (unrecorded
revenue and an unrecorded supplier bill), an expired input-VAT claim (6-month rule), a prohibited
input (hotel/restaurant), a duplicate purchase invoice, a credit note without its original, and
withholding-VAT certificates that match, differ from 2%, or have no invoice.

The files are generated from `lib/tax/demo.js` (`writeSampleCsvs`), which also seeds the demo workspace.
