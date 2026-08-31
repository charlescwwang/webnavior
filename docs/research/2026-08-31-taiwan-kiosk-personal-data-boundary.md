# Taiwan kiosk personal-data boundary research

> This note is product-design research, not legal advice. Obtain review from
> the operating entity's legal counsel and personal-data owner before public
> deployment.

## Why the kiosk needs a separate privacy workstream

The proposed kiosk processes camera images, may infer visitor attributes, and
may retain triggered video. The Taiwan Personal Data Protection Act (PDPA)
requires an organization collecting personal data to clearly inform data
subjects of the collector, purpose, categories of data, period/area/recipients
and method of use, rights, and the consequence of declining to provide data,
subject to statutory exceptions.

Source: [PDPA Article 8, National Development Council PDF](https://ws.ndc.gov.tw/001/administrator/30/laws/4/1e71c611-d58c-4ff4-8d1e-405987f5a5e4.pdf)

An official NDC interpretation describes facial images as highly identifying
biometric personal data and emphasizes necessity, less-intrusive alternatives,
and clear, understandable notice where consent is the legal basis.

Source: [NDC interpretation on facial-image collection](https://theme.ndc.gov.tw/lawout/NewsContent.aspx?id=10565)

The Executive Yuan has also stated that, in public venues where recording is
justified and necessary, recording should be publicly marked and proactively
notified, and the scope of capture and use should obtain consumer consent.

Source: [Executive Yuan public-venue privacy statement](https://ncsd.ndc.gov.tw/Fore/News_detail/1cd5b527-1ce2-4b06-9f27-56e8d42d1339)

## Product boundary proposed for AIRI

### Controlled POC

- Use named, informed test participants.
- Provide a dedicated consent and information notice before camera processing.
- Permit diagnostic video retention only under the configured automatic
  deletion period.
- Limit access to authorized test administrators.

### Public deployment baseline

- Run a privacy/legal review before launch; determine the operating entity,
  lawful basis, roles of any processors, notices, and data-subject request
  workflow.
- Use clear on-site notice and an accessible detailed policy.
- Default to no diagnostic-media retention or automatic upload.
- Keep proactive greeting neutral; defer age-band and perceived-gender
  inference until their necessity, notice, and control design are separately
  approved.

### Early field trial with diagnostic capture

- Treat this as a distinct deployment mode, not an ordinary production toggle.
- Require reviewed notice/consent flow, strict retention, role-limited access,
  audit logging, and a way to disable the mode remotely.

## Open questions for legal and product owners

1. Which legal entity is the data collector/controller for each kiosk?
2. What lawful basis and notice/consent flow applies in each venue?
3. Which vendors receive media, transcripts, or derived signals?
4. How are access, deletion requests, breach response, and cross-border data
   transfers handled?
5. Can the public deployment use demographic inference at all, and if so under
   which purpose and safeguards?
