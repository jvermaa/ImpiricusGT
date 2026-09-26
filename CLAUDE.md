This is the hackathon challenge

### **Impiricus**

💡 **Challenge: Invent the Next Way We Engage HCPs**

Scenario:

Build an HCP engagement tool Impiricus doesn’t offer today or one built on top of what Impiricus already does. This can include net-new channels or new value layered on the existing platform and data. SMS and any existing features Impiricus currently offers or ships today are off-limits.

Your Mission:

- Build a new HCP engagement tool.
- Create a net-new channel or add new value on top of Impiricus’s existing platform and data.
- Do not use SMS or recreate any existing Impiricus features.

Projects will be judged on:

- Impact on the HCP.
- Originality.
- Technical execution.
- Commercial fit.

Here is what I am thinking
A platform that is shown to the doctors. Having patient data would also greatly increase the data for ION complementing Pulse, Spark and Ascend

1. When the doctor is given a patient profile, the application picks up other patients from all the healthcare professionals in the database to pick up the diagnosis for those patients
   HCP Peer Case Exchange: Imagine you're a doctor and you have a weird case.

Instead of searching Google:

"Show me other HCPs who have dealt with something similar."

The platform takes a de-identified case description and finds relevant peers.
Constraints:
Impiricus said that we don't have enough data to correlate patient profiles
Frontend React Native fastest to develop. Vector Databases
Present History: Age group, 3 symptoms, sex, how much time for each symptom, frequency for each symptom, a factor that increases these symptom (cough is increased by lying down), gradual symptoms came up or sudden
Relevant Medical History, Family Medical history, medicines you take right now, alcohol, smoking, lab results, pregnancy, immunocompromised or immunocompetent
Diagnosis
Prescription
UI side: a button to find all relevant patient diagnosis from other HCPs. Once you click that button, it shows a popup where you can scroll and find patients ordered by how much they match (a confidence score maybe shown). On a patient you would only see Age group, 3 symptoms, Prescription and Diagnosis but clicking on a patient will give you all the information from above

2. Every Pulse or Spark notification leads to a chat box where HCP can communicate on its impacts and give their feedback

3. Doctors automatic follow up messages to patient. For example when doctors need to give steroids, they don’t give them all together. They have to check in routinely for any allergies, if the steroids need to be switched or the dosages changed.

4. An easy way to summarize the entire data so that it can be given to another doctor if we need to go to a new specialist or switch doctors it would be very easy to get the data
   Need to handle both other doctor has impiricus and doesn’t have impiricus
   Prescription, how much time for each symptom, frequency for each symptom, a factor that increases these symptom (cough is increased by lying down), gradual symptoms came up or sudden, and all the history of the background can be either summarized or turned into pictorial representations via an LLM

Application: went to a specialist or went to a different department and they need to know all medications you take currently

5. Clinical trials sent directly as push notifications to patients through doctors

6. A particular new development, which patients does it affect, if the patients need to be sent a follow up/notification. How the diagnosis may be affected etc.

7. Also connects the healthcare professionals. A doctor is not specialized in something and doesn’t have a lot of experience with it or just has a question, because of Impericus’s data, they would be able to connect HCP with each other.

8. Doctors can refer other doctors who are on the impiricus network using the app to the patients. They can then use number 4 to send all the data easily.

9. What's new page to show new drugs on the market, their benefits, research for evidence, side effects, relevant patients button.
