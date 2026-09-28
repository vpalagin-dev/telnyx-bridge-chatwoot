# JAMA! AI Messaging System

Product Requirements Document
Osono LLC d/b/a JAMA!

## 1. Product Overview

Build a scalable SMS messaging and AI customer-support system for JAMA!

The system will use:

- Telnyx as the SMS infrastructure/provider
- Chatwoot as the messaging interface, contact manager, campaign interface, and team inbox
- AI agent to answer incoming customer questions using JAMA-approved information
- Chatwoot's native functionality wherever possible rather than unnecessarily building custom features

The system should support JAMA's current database of approximately 10,000 contacts and scale comfortably to 20,000+ contacts.

The primary goals are to:

- Send large SMS campaigns affordably
- Personalize campaigns using customer names
- Send ticket/event links
- Manage contacts and audiences
- Receive and respond to customer replies
- Allow an AI agent to answer common questions
- Allow JAMA staff to take over conversations at any time

## 2. Telnyx Integration

Telnyx will provide the underlying SMS infrastructure. The system must support:

- Outbound SMS
- Inbound SMS
- Delivery/failure status where available
- Large campaign sending
- Proper message queueing
- Carrier-compliant sending
- Opt-out handling
- Telnyx webhooks as required
- SMS-capable phone number(s)

The developer should verify the appropriate Telnyx setup for JAMA's use case, including:

- Number type and messaging profile
- A2P/10DLC registration where applicable
- Approved campaign/use case and carrier requirements
- Throughput limits, messages-per-second limits, and Telnyx rate limits
- SMS pricing and applicable carrier fees

The system should be designed so Telnyx/carrier throughput — not application design — is the primary limitation on campaign speed.

## 3. Chatwoot Integration

Chatwoot should serve as the primary user interface for JAMA staff whenever practical. JAMA staff should be able to use Chatwoot to:

- View and search contacts
- View conversations
- Receive incoming SMS messages
- Respond manually
- Create/manage outbound campaigns
- View basic campaign status
- Assign conversations to team members
- Use the AI agent
- Take over AI conversations

Before custom development, determine which requirements can be handled through existing Chatwoot functionality. Custom development should only be used where Chatwoot's existing capabilities are insufficient.

## 4. Contact Management

The system must support a centralized list of SMS contacts. At minimum, each contact should support:

- First name
- Last name
- Phone number

The system should also support customizable contact attributes and/or tags, preferably using Chatwoot's existing custom-attribute functionality. Examples could include:

- City
- Source
- Event
- VIP status
- Customer type

These are examples only. The contact structure should remain customizable.

## 5. Contact Import

JAMA must be able to bulk import contacts, preferably using CSV. A CSV import should support at minimum:

- First name
- Last name
- Phone number

Where supported, it should also be possible to import tags and custom attributes. The import process should support column mapping. The system must be capable of importing 10,000–20,000+ contacts without requiring contacts to be manually created.

## 6. Duplicate Management

The system should prevent unnecessary duplicate contacts. Phone number should be the primary identifier for detecting duplicate SMS contacts. If an imported phone number already exists, the system should update or appropriately merge the contact rather than blindly creating another copy. The system should not unintentionally overwrite useful existing contact information.

## 7. Contact Export and Data Ownership

JAMA must retain ownership and portability of its contact data. Administrators should be able to export contacts, preferably as CSV. At minimum, exports should include:

- First name
- Last name
- Phone number
- Relevant custom attributes/tags
- SMS subscription/opt-out status where available

JAMA should not become dependent on Chatwoot in a way that prevents the company from retrieving its customer/contact data.

## 8. Audience Selection and Segmentation

Before sending a campaign, JAMA must be able to select the audience that should receive it. At minimum, audiences should be selectable using:

- All eligible SMS contacts
- Tags
- Custom contact attributes
- Selected/imported groups where practical

The system should also support excluding contacts or groups where practical. Most importantly, contacts who have opted out of SMS must always be automatically excluded.

## 9. SMS Campaign Creation

Authorized JAMA staff must be able to create an outbound SMS campaign. Campaign creation should include:

- Campaign name
- Audience
- Message
- Personalization
- Links
- Send now
- Schedule for later
- Preview/test send where possible
- Final confirmation before sending

The system should clearly show approximately how many contacts will receive the campaign before it is launched.

## 10. Message Personalization

SMS campaigns must support basic personalization. Required variable: `{{first_name}}`. Last name may also be supported: `{{last_name}}`.

Example campaign:

> Hi {{first_name}}, JULS is almost here! Get your tickets here: [LINK]

A recipient named Kofi would receive:

> Hi Kofi, JULS is almost here! Get your tickets here: [LINK]

No advanced behavioral personalization is required for V1.

## 11. Missing-Name Fallback

Personalization must fail gracefully when a contact does not have a first name. The system must not send messages such as:

> "Hi , JULS is almost here!" or "Hi undefined, JULS is almost here!"

There should be a configurable fallback. For example: "Hey! JULS is almost here!" The developer should determine the simplest reliable implementation based on Chatwoot's personalization functionality.

## 12. Links in SMS Messages

JAMA must be able to insert normal clickable URLs into SMS campaigns and individual messages. Examples include:

- Posh
- Ticketmaster
- Partiful
- Linktree
- Venue websites
- JAMA website
- Sugarcubes
- Other HTTPS URLs

The system does not need to build its own link-tracking or URL-shortening system. JAMA will use tracking functionality provided by platforms such as Posh when needed.

## 13. Test Messages

Before sending a large campaign, staff should be able to send a test message where technically practical. This allows JAMA to verify:

- Personalization
- Formatting
- Links
- Message content
- Overall appearance

before sending the message to thousands of contacts.

## 14. SMS Character and Segment Information

The campaign interface should, where practical, display:

- Character count
- Number of SMS segments
- Indication when special characters or emojis change SMS encoding and increase segment count

This is important because additional SMS segments directly affect campaign cost. If Chatwoot does not provide this functionality natively, determine the effort required to add it.

## 15. Campaign Cost Estimate

If practical using Telnyx pricing information, the system should show an estimated messaging cost before a large campaign is launched. For example:

> Recipients: 9,842 | SMS segments: 19,684 | Estimated messaging cost: $___

This is desirable but should not require building a complicated billing system.

## 16. Campaign Scheduling

JAMA should be able to:

- Send a campaign immediately
- Schedule a campaign for a future date/time

Scheduling should use the appropriate JAMA/Chicago timezone. Scheduled campaigns should be visible and cancellable before sending.

## 17. Large Campaign Throughput

The system must support campaigns to 10,000 contacts today and 20,000+ contacts as the database grows.

Desired performance:

- Target: Large campaigns complete within approximately 4–8 hours
- Acceptable: Under 24 hours
- Unacceptable: Campaigns routinely requiring approximately 48 hours or longer

Actual throughput will depend on Telnyx/carrier registration, number type, approved throughput, and other telecommunications restrictions. The developer should test and document actual expected throughput rather than assuming Chatwoot determines sending speed.

## 18. Message Queueing

Large campaigns must be properly queued. The system should:

- Respect Telnyx/carrier rate limits
- Avoid duplicate sends
- Track which messages have been submitted
- Handle temporary failures appropriately
- Identify permanent failures where possible
- Prevent a campaign from accidentally being launched multiple times

If a campaign can be cancelled while sending, the system should avoid resending to contacts who already received it.

## 19. Basic Campaign Status

JAMA needs enough operational information to determine whether a campaign was successfully sent. Where available, show:

- Number targeted
- Number queued
- Number sent
- Number delivered
- Number failed
- Number opted out
- Campaign status

Example:

> Campaign: Juls Final Push | Targeted: 9,850 | Sent: 9,742 | Delivered: 9,510 | Failed: 232 | Opt-outs: 18 | Status: Complete

No custom revenue attribution or conversion analytics are required.

## 20. SMS Opt-Out Management

The system must properly handle SMS opt-outs and suppression. Applicable opt-out requests should be processed appropriately, including common commands such as:

- STOP
- UNSUBSCRIBE
- CANCEL
- END
- QUIT

Once a contact has opted out, the system must prevent future marketing campaigns from being sent to that phone number unless the contact validly opts back in. Opted-out contacts should not simply be deleted — their suppression/opt-out status should remain recorded so they are not accidentally re-added through a later CSV import.

## 21. Incoming SMS

Customers must be able to reply to JAMA messages. Incoming messages should appear as conversations inside Chatwoot. For example:

> JAMA sends: "Hi Sarah, AfroRave on the River starts at 5PM today!"
> Sarah replies: "Where should I Uber to?"

The reply should appear in the JAMA team's Chatwoot inbox.

## 22. Individual Messaging

Authorized staff must be able to search for a contact and send that person an individual SMS. Contacts should be searchable using:

- Name
- Phone number

Individual conversations should remain accessible in Chatwoot.

## 23. AI JAMA Agent

An AI agent should be connected to the messaging system to answer common incoming customer questions using JAMA-approved knowledge. Example questions:

- What time does JAMA start?
- Where is the venue?
- Where should I Uber?
- Is the event free?
- Where can I get tickets?
- What's the age requirement?
- What time does the headliner perform?
- What's the dress code?
- Is there parking?
- What's the refund policy?

## 24. AI Knowledge Base

JAMA administrators should be able to provide/update the information used by the AI. Where practical, use Chatwoot's existing AI/knowledge functionality. Knowledge may include:

- Event information and calendar
- Venue details
- Parking instructions
- Ticket links and policies
- FAQs and set times
- Age requirements
- JAMA information
- Refund policies
- Other customer-support information

Updating this information should ideally not require code changes.

## 25. Event-Specific Knowledge

The AI must distinguish between different JAMA events. For example:

- AfroRave on the River: one venue, one date/time, free RSVP
- JAMA! ft. Juls: different venue, different date/time, paid ticket

The AI must not accidentally provide information from one event when answering a question about another. The developer should determine the best way to organize event-specific knowledge within Chatwoot/the AI layer.

## 26. AI Uncertainty and Escalation

The AI must not invent information when it does not know the answer. When reliable information is unavailable, it should say something similar to:

> "I'm not sure about that. Let me get someone from the JAMA team to help you."

Human escalation should be particularly available for:

- Refund/payment disputes
- Complaints
- Safety issues
- VIP/artist requests
- Partnership inquiries
- Sponsorship
- Press/media
- Unusual requests
- Questions not covered by the knowledge base

## 27. Human Takeover

A JAMA staff member must be able to take over an AI conversation at any time. Once a human has taken over, the AI should stop automatically responding until the conversation is intentionally returned to AI handling or otherwise resolved. The system should make it obvious to staff whether a conversation is currently being handled by:

- AI
- Human
- Waiting for human response

## 28. AI Outbound Restrictions

The AI must never autonomously initiate marketing messages or campaigns. This is a hard requirement.

Outbound SMS may only be initiated by:

- A human sending an individual message
- A human creating/approving a campaign
- An automation that JAMA has explicitly configured and approved

The AI may assist with drafting messages, but it may not independently decide who to contact or when to contact them.

## 29. User Roles and Permissions

Where supported by Chatwoot, permissions should distinguish between users who can:

- Administer the system
- Create/send campaigns
- Manage contacts
- Respond to individual conversations
- View conversations

Not every support user should automatically have permission to launch a campaign to the entire JAMA database.

## 30. Reliability and Error Prevention

The system should be designed to prevent:

- Duplicate campaign sends
- Sending to opted-out contacts
- Broken personalization
- Invalid/malformed links where detectable
- Repeated sends to invalid phone numbers
- Accidental mass campaigns
- Loss of incoming customer replies

Large sends should require an explicit confirmation before launch.

## 31. Out of Scope: Analytics & Customer Intelligence

The messaging system does not need to become JAMA's customer analytics or business-intelligence platform. The following are not required:

- Custom click-tracking system
- Unique links for every recipient
- Purchase attribution
- Revenue attribution
- Customer lifetime-value calculations
- Customer scoring
- Propensity modeling
- Marketing ROI dashboards
- Event-performance analytics
- Advanced customer-behavior analysis

JAMA plans to maintain a separate local customer/event data system with Claude as the analysis layer. The messaging platform should focus on communication and execution.

## 32. V1 Acceptance Requirements

For Version 1 to be considered successful, JAMA must be able to:

1. Connect Telnyx + Chatwoot
2. Import 10,000+ contacts
3. Store first name, last name, and phone number
4. Support customizable contact attributes/tags
5. Handle duplicate contacts appropriately
6. Create/select an SMS audience
7. Personalize campaigns with first name
8. Handle contacts with missing first names gracefully
9. Insert clickable ticket/event links
10. Create an outbound SMS campaign
11. Send a test message where practical
12. Send immediately
13. Schedule a future campaign
14. Safely queue large campaigns
15. Support growth to 20,000+ contacts
16. Properly process SMS opt-outs/suppression
17. Show basic sent/delivered/failed campaign status where available
18. Receive incoming replies in Chatwoot
19. Search contacts and send individual SMS messages
20. Allow the AI agent to answer incoming questions from JAMA-approved knowledge
21. Support event-specific AI information
22. Escalate uncertain AI conversations to humans
23. Allow immediate human takeover
24. Prevent the AI from autonomously initiating outbound messages
25. Export JAMA's contact data

## Developer's First Task

Before building custom functionality, audit the current versions of Chatwoot and Telnyx against these requirements. For every requirement, classify it as:

- A. Supported natively by Chatwoot/Telnyx
- B. Supported with configuration/integration
- C. Requires custom development
- D. Not recommended / technically problematic

Then provide:

- Proposed architecture
- Required integrations
- Required custom development
- Telnyx/carrier requirements
- Expected SMS throughput for 10K and 20K campaigns
- Estimated infrastructure cost
- Estimated development effort
- Any requirements that should be modified based on technical limitations

Do not begin by rebuilding features that Chatwoot or Telnyx already provide.
