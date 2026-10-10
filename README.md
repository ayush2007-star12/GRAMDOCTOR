# GramDoc

Health check, video consultation, prescription and follow-up for villages.
Plain HTML, CSS and JavaScript. No build step, no server, no database.

## How it works
1. Health worker opens "New check", enters the patient, symptoms and readings (BP, sugar, temperature, oxygen, pulse).
2. The app shows a risk level: Emergency, See doctor now, See doctor today, or Looks normal, with the reasons.
3. The health worker taps "Start video call" (opens a Jitsi room) and "Send case to doctor on WhatsApp".
4. The doctor opens the link, sees the case, joins the same video room and creates a prescription.
5. The doctor sends the prescription link back. When the health worker opens it, it is saved with the patient and the follow-up date is set.
6. "Patients" lists everyone with follow-up status and can export a CSV.

English and Hindi. Works offline after the first visit (the video call needs internet).

## Run on your computer
Open `index.html` in a browser. For the offline/install features use a local server, for example `python3 -m http.server`.

## Put it on Vercel
1. Upload all files in this folder to a new GitHub repository (files at the top level, not inside a sub-folder).
2. On vercel.com choose Add New > Project, import the repository, Framework Preset "Other", leave build settings empty, press Deploy.
   Or run `npx vercel --prod` inside this folder.

## Tests
`node test-triage.js` checks the risk rules.

## Important
- The risk rules in `triage.js` are a simple screening aid, not a diagnosis. Have a doctor review the limits before real use.
- Patient data is stored only in the browser of the phone that created it. The case and prescription links contain patient details inside the link (after the `#`, which is not sent to any server). Share them only with the doctor.
- Video calls use the free public Jitsi service (meet.jit.si). Room names are random, but for real use run your own Jitsi server or a paid service.
