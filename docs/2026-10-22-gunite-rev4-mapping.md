# Gunite Rev4 vs live Gunite template mapping (2026-10-22)

- Live (BuildType Gunite): 8 phase names, 46 sub-phases, 295 tasks.
- Rev4 (the workbook sheet is titled "Gunite Build Phase_Rev2_081426"): 12 phases (0 to 11), 70 sub-phases (including three-level numbers), 384 task lines.
- Matching: normalised sub-phase name (case, whitespace, punctuation ignored), preferring the same number; then unmatched Rev4 sub-phases by share of live tasks whose text appears in the Rev4 sub-phase (overlap) plus name similarity; then split/merge detection from where task text came from. Task text is compared normalised.
- Result: exact 41, renamed 4, split/merged 2, new 23, live sub-phases with no Rev4 match 1.

## Table A: Rev4 sub-phases in Rev4 order

| Rev4 no | Rev4 name | Rev4 tasks | live no | live name | live row id | match | note |
|---|---|---|---|---|---|---|---|
| 0.0 | Sales to Production Handoff | 0 | 0.0 | Sales to Production Handoff | 1 | exact name | tasks live 17 vs Rev4 0 |
| 0.1 | Contract review | 4 |  |  |  | split/merged (check) | tasks drawn from live 0.0 (4) |
| 0.2 | Approved Construction Plans | 2 |  |  |  | new |  |
| 0.3 | Verifications | 5 |  |  |  | new |  |
| 0.4 | Procurement Planning | 18 |  |  |  | new |  |
| 0.5 | Budget verification | 0 |  |  |  | new |  |
| 1.0 | Pre-Construction Back Office Admin | 15 | 1.0 | Pre-Construction Back Office Admin | 2 | exact name | tasks live 19 vs Rev4 15 |
| 1.1 | Pre-Construction Verification - HANDOVER FROM OFFICE TO FIELD PM | 11 | 1.1 | Pre-Construction Verification - HANDOVER FROM OFFICE TO FIELD PM | 3 | exact name | tasks live 10 vs Rev4 11 |
| 1.2 | Site Preparation | 16 | 1.2 | Site Preparation | 4 | exact name | tasks live 9 vs Rev4 16 |
| 1.2.1 | Site Inspection prior to Permit/Codes | 1 |  |  |  | new |  |
| 1.3 | Order/Procure Site Materials | 8 |  |  |  | new |  |
| 1.4 | Pool Layout | 8 | 1.3 | Pool Layout | 5 | exact name | number changed 1.3 to 1.4 |
| 1.5 | Pre-Dig Quality Check | 7 | 1.4 | Pre-Dig Quality Check | 6 | exact name | number changed 1.4 to 1.5 |
| 1.6 | Excavation Operations | 10 | 1.5 | Excavation Operations | 7 | exact name | number changed 1.5 to 1.6; tasks live 11 vs Rev4 10 |
| 1.7 | Post-Excavation Review | 9 | 1.6 | Post-Excavation Review | 8 | exact name | number changed 1.6 to 1.7; tasks live 8 vs Rev4 9 |
| 2.1 | Engineering Review by PM | 6 | 2.1 | Engineering Review by PM | 9 | exact name |  |
| 2.2 | Steel Installation and Forms | 7 | 2.2 | Steel Installation and Forms | 10 | exact name |  |
| 2.3 | Bond Beam Preparation | 7 | 2.3 | Bond Beam Preparation | 11 | exact name |  |
| 2.4 | Bonding System Installation | 12 | 2.4 | Bonding System Installation | 12 | exact name | tasks live 4 vs Rev4 12 |
| 2.5 | Pre-Gunite Structural Inspection - Rebar | 4 | 2.6 | Pre-Gunite Structural Inspection | 14 | renamed | task overlap 100% |
| 2.6 | Steel QC Inspection Municipal Inspection | 0 | 2.5 | Steel QC Inspection Municipal Inspection | 13 | exact name | number changed 2.5 to 2.6; tasks live 7 vs Rev4 0 |
| 3.1 | Hydraulic Design Verification | 7 | 3.1 | Hydraulic Design Verification | 15 | exact name |  |
| 3.2 | Underground Plumbing Installation | 7 | 3.2 | Underground Plumbing Installation | 16 | exact name |  |
| 3.3 | Plumbing Pressure Testing | 7 | 3.3 | Plumbing Pressure Testing | 17 | exact name |  |
| 3.4 | Plumbing Municaple Head Test | 0 |  |  |  | new |  |
| 4.1 | Electrical Rough-In | 7 | 3.4 | Electrical Rough-In | 18 | exact name | number changed 3.4 to 4.1 |
| 4.2 | Bonding Grid Completion | 4 | 3.5 | Bonding Grid Completion | 19 | exact name | number changed 3.5 to 4.2 |
| 4.3 | Equipment Pad Preparation | 7 | 3.6 | Equipment Pad Preparation | 20 | exact name | number changed 3.6 to 4.3 |
| 4.4 | Rough Inspection Preparation | 5 | 3.7 | Rough Inspection Preparation | 21 | exact name | number changed 3.7 to 4.4; tasks live 4 vs Rev4 5 |
| 4.5 | Bonding Inspection | 0 |  |  |  | new |  |
| 4.6 | Conduit Inspection | 0 |  |  |  | new |  |
| 5.1 | Pre-Shoot Readiness Review | 7 | 4.1 | Pre-Shoot Readiness Review | 22 | exact name | number changed 4.1 to 5.1 |
| 5.2 | Crew Pre-Shoot Meeting OnSite Day of Shoot | 4 | 4.2 | Crew Pre-Shoot Meeting | 23 | renamed | task overlap 100% |
| 5.3 | Shotcrete Placement | 7 | 4.3 | Shotcrete Placement | 24 | exact name | number changed 4.3 to 5.3 |
| 5.4 | Real-Time QC Monitoring | 4 | 4.4 | Real-Time QC Monitoring | 25 | exact name | number changed 4.4 to 5.4 |
| 5.5 | Shaping & Finishing | 4 | 4.5 | Shaping & Finishing | 26 | exact name | number changed 4.5 to 5.5 |
| 5.6 | Post-Shoot Inspection | 5 | 4.6 | Post-Shoot Inspection | 27 | exact name | number changed 4.6 to 5.6 |
| 5.7 | Curing Program | 5 | 4.7 | Curing Program | 28 | exact name | number changed 4.7 to 5.7 |
| 6.1 | Material Verification | 7 | 5.1 | Material Verification | 29 | exact name | number changed 5.1 to 6.1; tasks live 5 vs Rev4 7 |
| 6.2 | Waterproofing & Surface Prep | 4 | 5.2 | Waterproofing & Surface Prep | 30 | exact name | number changed 5.2 to 6.2 |
| 6.3 | Tile and Grout Installation | 7 | 5.3 | Tile Installation | 31 | renamed | task overlap 83%; tasks live 6 vs Rev4 7 |
| 6.4 | Auto Cover Rough In | 1 |  |  |  | new |  |
| 6.5 | Coping Installation | 6 | 5.4 | Coping Installation | 32 | exact name | number changed 5.4 to 6.5; tasks live 7 vs Rev4 6 |
| 6.6 | Water Feature and Veneers | 4 |  |  |  | split/merged (check) | tasks drawn from live 5.4 (2) |
| 6.7 | Underground Infrastructure | 2 |  |  |  | new |  |
| 6.8 | Drainage Verification | 4 | 5.7 | Drainage Verification | 35 | exact name | number changed 5.7 to 6.8 |
| 6.9 | Deck Preparation | 6 | 5.5 | Deck Preparation | 33 | exact name | number changed 5.5 to 6.9; tasks live 4 vs Rev4 6 |
| 6.10 | Deck Placement | 5 | 5.6 | Deck Placement | 34 | exact name | number changed 5.6 to 6.10; tasks live 6 vs Rev4 5 |
| 6.11 | Hardscape Final QC | 4 | 5.8 | Hardscape Final QC | 36 | exact name | number changed 5.8 to 6.11 |
| 7.1 | Equipment Plumbing | 7 | 6.2 | Equipment Plumbing | 38 | exact name | number changed 6.2 to 7.1; tasks live 6 vs Rev4 7 |
| 7.2 | Equipment Installation | 7 | 6.1 | Equipment Installation | 37 | exact name | number changed 6.1 to 7.2; tasks live 6 vs Rev4 7 |
| 7.3 | Equipment Electrical | 5 | 6.3 | Equipment Electrical | 39 | exact name | number changed 6.3 to 7.3 |
| 7.4 | Gas Line Rough In | 3 |  |  |  | new |  |
| 8.1 | Interior Finish Preparation | 6 | 6.4 | Interior Finish Preparation | 40 | exact name | number changed 6.4 to 8.1; tasks live 5 vs Rev4 6 |
| 8.2 | Interior Finish | 4 | 6.5 | Interior Finish & Fill | 41 | renamed | task overlap 50% |
| 8.3 | Startup Procedures | 7 | 6.6 | Startup Procedures | 42 | exact name | number changed 6.6 to 8.3 |
| 8.4 | Water Chemistry Startup | 5 | 6.7 | Water Chemistry Startup | 43 | exact name | number changed 6.7 to 8.4; tasks live 4 vs Rev4 5 |
| 8.5 | Trim Out | 6 |  |  |  | new |  |
| 9.1 | Verification Review | 3 |  |  |  | new |  |
| 9.2 | Crew Review | 2 |  |  |  | new |  |
| 9.3 | QC Review | 4 |  |  |  | new |  |
| 10.1 | Construction Cleanup | 5 |  |  |  | new |  |
| 10.2 | Backfill | 3 |  |  |  | new |  |
| 10.3 | Rough Grade | 3 |  |  |  | new |  |
| 10.4 | Final Grade | 4 |  |  |  | new |  |
| 10.5 | Seed and Straw | 4 |  |  |  | new |  |
| 10.6 | Landscaping Restoration | 6 |  |  |  | new |  |
| 10.7 | Final Site Walk-Through | 5 |  |  |  | new |  |
| 11.0 | Client Orientation | 10 | 6.8 | Client Orientation | 44 | exact name | number changed 6.8 to 11.0; tasks live 5 vs Rev4 10 |
| 11.1 | Warranty & 30-Day Follow-Up | 5 | 7.0 | Warranty & 30-Day Follow-Up | 46 | exact name | number changed 7.0 to 11.1 |

## Table B: live sub-phases with no Rev4 match

| live no | live name | live row id | live tasks | where tasks went (Rev4 sub-phase: count) |
|---|---|---|---|---|
| 6.9 | Final Project Closeout | 45 | 5 | 11.0: 5 |

## Table C: tasks that moved between sub-phases

Total moved: 25 of 295 live tasks (text found in Rev4 only under a different sub-phase than the matched one). Live tasks with no identical text anywhere in Rev4: 34. Showing up to 40 moved.

| task | live sub-phase | Rev4 sub-phase |
|---|---|---|
| Signed | 0.0 Sales to Production Handoff | 0.1 Contract review |
| Design verification | 0.0 Sales to Production Handoff | 0.1 Contract review |
| Draw schedule | 0.0 Sales to Production Handoff | 0.1 Contract review |
| Change orders process | 0.0 Sales to Production Handoff | 0.1 Contract review |
| Material Selections Approved | 0.0 Sales to Production Handoff | 0.3 Verifications |
| Equipment specifications approved | 0.0 Sales to Production Handoff | 0.3 Verifications |
| HOA Submittals to Client | 0.0 Sales to Production Handoff | 1.0 Pre-Construction Back Office Admin |
| Delivered | 1.0 Pre-Construction Back Office Admin | 1.2 Site Preparation |
| Permit Downloaded/Printed/shared | 1.0 Pre-Construction Back Office Admin | 1.2.1 Site Inspection prior to Permit/Codes |
| D2 Pool Sign in the Yard | 1.0 Pre-Construction Back Office Admin | 1.2 Site Preparation |
| Steel elevation verification | 2.5 Steel QC Inspection Municipal Inspection | 2.4 Bonding System Installation |
| Penetration reinforcement review | 2.5 Steel QC Inspection Municipal Inspection | 2.4 Bonding System Installation |
| Steel clearance verification | 2.5 Steel QC Inspection Municipal Inspection | 2.4 Bonding System Installation |
| Bond Beam Verification | 2.5 Steel QC Inspection Municipal Inspection | 2.4 Bonding System Installation |
| Rebar spacing verification | 2.5 Steel QC Inspection Municipal Inspection | 2.4 Bonding System Installation |
| Chair placement and height verification | 2.5 Steel QC Inspection Municipal Inspection | 2.4 Bonding System Installation |
| Structural Elements Thickened Wall, Raised Bond Beam Review and verification | 2.5 Steel QC Inspection Municipal Inspection | 2.4 Bonding System Installation |
| Inspection sign-off | 3.7 Rough Inspection Preparation | 2.5 Pre-Gunite Structural Inspection - Rebar |
| Spa Veneer | 5.4 Coping Installation | 6.6 Water Feature and Veneers |
| Water Feature Veneer | 5.4 Coping Installation | 6.6 Water Feature and Veneers |
| Final inspection | 6.9 Final Project Closeout | 11.0 Client Orientation |
| Punch-list completion | 6.9 Final Project Closeout | 11.0 Client Orientation |
| Photo documentation | 6.9 Final Project Closeout | 11.0 Client Orientation |
| Warranty registration | 6.9 Final Project Closeout | 11.0 Client Orientation |
| Customer Pool School | 6.9 Final Project Closeout | 11.0 Client Orientation |

Live tasks with no identical text in Rev4 (reworded or removed), first 40 of 34:

| task | live sub-phase |
|---|---|
| Contract review | 0.0 Sales to Production Handoff |
| Approved Construction Plans | 0.0 Sales to Production Handoff |
| Pools Dimensions Verified | 0.0 Sales to Production Handoff |
| Spa Dimensions Verified | 0.0 Sales to Production Handoff |
| Feature locations | 0.0 Sales to Production Handoff |
| Selections | 0.0 Sales to Production Handoff |
| Procurement planning | 0.0 Sales to Production Handoff |
| Permit submission | 0.0 Sales to Production Handoff |
| Start ordering Materials as needed? | 0.0 Sales to Production Handoff |
| Budget verification | 0.0 Sales to Production Handoff |
| Order Shell if Fiberglass to meet schedule | 1.0 Pre-Construction Back Office Admin |
| PortaPotty Submitted | 1.0 Pre-Construction Back Office Admin |
| HOA Approval | 1.0 Pre-Construction Back Office Admin |
| HOA Submission Document | 1.0 Pre-Construction Back Office Admin |
| Contruction Tote for supplies onsite | 1.0 Pre-Construction Back Office Admin |
| Site Inspection prior to Permit/Codes | 1.0 Pre-Construction Back Office Admin |
| Evacuate Shell | 1.5 Excavation Operations |
| Evacuate Spa | 1.5 Excavation Operations |
| Evacuate benches | 1.5 Excavation Operations |
| Evacuate Plumbing and Electrical trenches | 1.5 Excavation Operations |
| Shelf and bench measurements | 1.5 Excavation Operations |
| Evacuate Steps | 1.5 Excavation Operations |
| Evacuation Images obtained | 1.6 Post-Excavation Review |
| Evacuation Shape | 1.6 Post-Excavation Review |
| Coping approval | 5.1 Material Verification |
| Deck material approval | 5.1 Material Verification |
| Tile approval | 5.1 Material Verification |
| Waterline tile layout | 5.3 Tile Installation |
| Water Feature and Veneers | 5.4 Coping Installation |
| Auto Cover Rough in | 5.6 Deck Placement |
| Trim Out Pool - Main Drains and Covers | 6.4 Interior Finish Preparation |
| Water source verification | 6.4 Interior Finish Preparation |
| Fill documentation | 6.5 Interior Finish & Fill |
| Fill supervision | 6.5 Interior Finish & Fill |

Rev4 task lines with no identical text in the live template: 123 of 384.

## Feature-specific lines in Rev4

| Rev4 sub-phase | line | kind | feature keyword |
|---|---|---|---|
| 0.3 Verifications | Spa Manufacture Model and Color Verified | task | spa |
| 0.3 Verifications | Feature locations: different on every project/firebowls/waterfall/grotto/deskjets/spillovers/water and firebow/infinity edge | task | deskjets, firebowls, grotto, infinity, spillovers, waterfall |
| 0.4 Procurement Planning | Vaneer | task | vaneer |
| 1.1 Pre-Construction Verification - HANDOVER FROM OFFICE TO FIELD PM | Verify Auto Cover YES/NO | task | auto cover |
| 1.3 Order/Procure Site Materials | spa fittings | task | spa |
| 1.4 Pool Layout | Feature layout (spa, tanning ledge, fire features, water features | task | fire, spa, tanning, water features |
| 1.4 Pool Layout | Auto Cover Layout | task | auto cover |
| 1.6 Excavation Operations | Excavate Spa | task | spa |
| 1.6 Excavation Operations | Water Feature(s) verification | task | water feature |
| 1.7 Post-Excavation Review | Auto Cover vault - Y/N | task | auto cover |
| 2.1 Engineering Review by PM | Spa wall reinforcement verification | task | spa |
| 2.2 Steel Installation and Forms | Spa Reinforcement | task | spa |
| 3.1 Hydraulic Design Verification | Water feature hydraulic review | task | water feature |
| 3.2 Underground Plumbing Installation | Spa jet plumbing | task | spa |
| 3.2 Underground Plumbing Installation | Water feature plumbing | task | water feature |
| 4.1 Electrical Rough-In | Conduit for Water Features and Lights | task | water features |
| 4.1 Electrical Rough-In | Auto Cover Conduit | task | auto cover |
| 5.1 Pre-Shoot Readiness Review | Auto Cover Conduit in Vault | task | auto cover |
| 5.3 Shotcrete Placement | Spa shoot | task | spa |
| 5.3 Shotcrete Placement | Auto Cover shoot | task | auto cover |
| 6.3 Tile and Grout Installation | Waterline and Water Feature Layouts/Verified with Crews | task | water feature |
| 6.3 Tile and Grout Installation | Spa tile installation | task | spa |
| 6.4 | Auto Cover Rough In | whole sub-phase | auto cover |
| 6.4 Auto Cover Rough In | Auto cover rails and brackets installed | task | auto cover |
| 6.5 Coping Installation | Auto Cover Rough-in YES /NO | task | auto cover |
| 6.6 | Water Feature and Veneers | whole sub-phase | water feature |
| 6.6 Water Feature and Veneers | Spa Veneer | task | spa, veneer |
| 6.6 Water Feature and Veneers | Water Feature Veneer | task | veneer, water feature |
| 6.7 Underground Infrastructure | Gas Line Installed | task | gas |
| 7.1 Equipment Plumbing | Water Feature verification | task | water feature |
| 7.3 Equipment Electrical | Auto Cover Switch | task | auto cover |
| 7.4 | Gas Line Rough In | whole sub-phase | gas |
| 7.4 Gas Line Rough In | Gas Line Inspection | task | gas |
| 7.4 Gas Line Rough In | Gas Line Hookup | task | gas |
| 7.4 Gas Line Rough In | Gas Line Testing | task | gas |
| 8.3 Startup Procedures | Auto Cover Installed | task | auto cover |
| 8.5 Trim Out | Spa Jets | task | spa |
| 8.5 Trim Out | Water Features (deck jets/waterfalls/spillovers) | task | deck jets, spillovers, water features, waterfalls |

## Anomalies

Sub-phases with zero tasks: 0.0 Sales to Production Handoff, 0.5 Budget verification, 2.6 Steel QC Inspection Municipal Inspection, 3.4 Plumbing Municaple Head Test, 4.5 Bonding Inspection, 4.6 Conduit Inspection.

Three-level numbers: 1.2.1 Site Inspection prior to Permit/Codes.

Duplicated sub-phase names: none.

Sub-phase number vs phase heading mismatches: none.

Phase headings: PHASE 0.   PRE CONSTRUCTION/SALES; PHASE 1.   PRECONSTRUCTION BACK OFFICE ADMIN; PHASE 2.   FORM and REBAR; PHASE 3.   PLUMBING ROUGH-IN; PHASE 4.   ELECTRICAL ROUGH-IN; PHASE 5.   GUNITE AND SHOTCRETE; PHASE 6.   PRECONSTRUCTION MATERIAL; PHASE 7.   CONSTRUCTION EQUIPMENT INSTALLATION; PHASE 8.   INTERIOR FINISH AND TRIM OUT; PHASE 9.   SITE RESTORATION & FINAL GRADE; PHASE 10. POOL START UP; PHASE 11. POST CONSTUCTION COMPLETION PHASE

Rows carrying Predecessors, Duration or other column values (excel row, sub-phase, line, cells from column 3 on):

| row | sub-phase | line | cells |
|---|---|---|---|
| 45 | 1.0 | Permit submitted | 39, 40, 41 /  /  /  /  /  /  /  / 1d |
| 84 | 1.2.1 | (sub-phase row) 1.2.1 Site Inspection prior to Permit/Codes | 66, 67, 68, 69, 70, 71, 72, 73, 75, 76, 77 |
| 233 | 5.1 | (sub-phase row) 5.1 Pre-Shoot Readiness Review | 219, 220, 221, 222, 223, 224 |
| 241 | 5.2 | (sub-phase row) 5.2 Crew Pre-Shoot Meeting OnSite Day of Shoot | 226 |
| 246 | 5.3 | (sub-phase row) 5.3 Shotcrete Placement | 226, 234 |
| 290 | 6.3 | (sub-phase row) 6.3 Tile and Grout Installation | 277 |
| 292 | 6.3 | Waterline Tile installation |  /  /  /  /  /  /  /  / 1d |
| 293 | 6.3 | Feature tile installation |  /  /  /  /  /  /  /  / 1d |
| 294 | 6.3 | Spa tile installation |  /  /  /  /  /  /  /  / 1d |
| 295 | 6.3 | Tile Level Verification |  /  /  /  /  /  /  /  / 1d |
| 296 | 6.3 | Verify Grout Joint Alignment |  /  /  /  /  /  /  /  / 1d |
| 297 | 6.3 | Expansion Joints Installation |  /  /  /  /  /  /  /  / 1d |
| 300 | 6.5 | (sub-phase row) 6.5 Coping Installation | 277, 284 |
| 327 | 6.10 | (sub-phase row) 6.10 Deck Placement | 311, 277, 292 |
| 341 | 7.1 | Manifold assembly | 330 /  /  /  /  /  /  /  / 1d |
| 342 | 7.1 | Valve installation | 330 /  /  /  /  /  /  /  / 1d |
| 343 | 7.1 | Check valve installation | 330 /  /  /  /  /  /  /  / 1d |
| 344 | 7.1 | Flow verification | 330 /  /  /  /  /  /  /  / 1d |
| 345 | 7.1 | Water Feature verification | 330 /  /  /  /  /  /  /  / 1d |
| 346 | 7.1 | Auto Leveler and Pool Drain verification | 330 /  /  /  /  /  /  /  / 1d |
| 349 | 7.2 | Pump installation | 338 /  /  /  /  /  /  /  / 1d |
| 350 | 7.2 | Filter installation | 338 /  /  /  /  /  /  /  / 1d |
| 351 | 7.2 | Heater installation | 338 /  /  /  /  /  /  /  / 1d |
| 352 | 7.2 | Chiller Instalation | 338 /  /  /  /  /  /  /  / 1d |
| 353 | 7.2 | Automation installation | 338 /  /  /  /  /  /  /  / 1d |
| 354 | 7.2 | Sanitizer installation | 338 /  /  /  /  /  /  /  / 1d |
| 373 | 8.2 | (sub-phase row) 8.2 Interior Finish | 354 |
| 462 | 11.0 | Punch-list completion | need to manually added and dates |

Column headers on row 1: Section and Task, Phase, Predecessors, Duration, Start Date, End Date, Assigned To, Status, % Complete, Notes, Duration2.

Other oddities: the sheet name says Rev2_081426. Excel row 454 "Ability to add multipal single line items to the schedule" is a note-like line under 10.7 numbered phase 10. Typos kept verbatim in source: "Barrior", "CONSTUCTION", "Contruction", "multipal", "Vaneer".

Comments sheet:

- 1 Row 357 / this to be order/water truck and plaster to be ordered at start of coping / Don Borgeson / 08/14/26 1:30 PM
