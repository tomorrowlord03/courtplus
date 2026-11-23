import { Page } from '../components/ui';

export function Safeguards() {
  return (
    <Page title="Safeguards">
      <div className="grid max-w-3xl gap-4">
        <section className="rounded border bg-white p-3">
          <h2 className="font-semibold">What this tool does</h2>
          <ul className="list-disc pl-5 text-sm">
            <li>Reads court orders on this computer and suggests fields, each with the sentence it came from.</li>
            <li>Counts custody days and shows every step, with the statute quoted.</li>
            <li>Lists people who may be eligible, so legal-aid staff can check them first.</li>
            <li>Prepares drafts and signs them so changes can be detected.</li>
          </ul>
        </section>
        <section className="rounded border bg-white p-3">
          <h2 className="font-semibold">What it does not do</h2>
          <ul className="list-disc pl-5 text-sm">
            <li><strong>No prediction.</strong> It never predicts a court's decision, a person's risk or an outcome (SC draft Regulations for Use of AI in Courts, 2026, r.20(1)(d); not yet in force).</li>
            <li>No AI in the screen: the custody count and status come from fixed rules shown in the proof trace. The AI only suggests fields from orders, and a person confirms each one.</li>
            <li>It does not decide eligibility, grant bail or file anything. The jail superintendent files the s.479(3) application; the court decides release.</li>
            <li>Framed charges count only after a person verifies them against the order.</li>
          </ul>
        </section>
        <section className="rounded border bg-white p-3">
          <h2 className="font-semibold">Day convention</h2>
          <p className="text-sm">The day convention used is shown on every result. If a rule is unclear, the case goes to “Needs a lawyer”.</p>
        </section>
        <section className="rounded border bg-white p-3">
          <h2 className="font-semibold">Your data stays here</h2>
          <p className="text-sm">Desktop and prison-LAN installs send no data over the internet. The optional cloud appliance stores data encrypted on the operator's server and is reached over HTTPS. Names are masked on screen by default.</p>
        </section>
        <section className="rounded border bg-white p-3">
          <h2 className="font-semibold">Model card (summary)</h2>
          <p className="text-sm">
            The reading assistant is a language model fine-tuned to tag names, courts, dates and statute references in orders.
            It can be wrong, and scanned orders are read less reliably. Every suggestion shows its source sentence and needs
            a person's Confirm. Measured scores are in the full model card shipped with the app.
          </p>
        </section>
      </div>
    </Page>
  );
}
