BAB ICIVITAS
BAB IIProduct Requirements Document (PRD) & Master Engineering Specification
Product: CIVITAS
Category: AI-powered collaborative 3D city simulation platform
Product tagline: The City Is Your Meeting Room.
Document version: 1.0
Status: Initial product specification
Target: Web application, desktop and mobile
Primary language: English for code and technical identifiers; Indonesian and English-ready interface.
 
BAB IIIPART I — PRODUCT DEFINITION
BAB IV1. Product Overview
CIVITAS is a multiplayer, AI-powered, interactive 3D city simulation and collaboration platform.
It transforms conventional virtual meetings into shared, explorable 3D environments.
Instead of joining a traditional video conferencing interface, users enter a virtual city where they can:
•	Meet and communicate with other users.
•	Navigate a shared 3D environment using avatars.
•	Create and customize buildings, roads, and public spaces.
•	Collaboratively design urban environments.
•	Simulate transportation systems and urban development.
•	Use AI to generate structures and assist with city planning.
•	Present ideas and collaborate in real time.
CIVITAS combines three core experiences:
1.	Communication: A virtual meeting platform comparable to Zoom and Google Meet.
2.	Creation: A collaborative 3D environment comparable to a simplified Minecraft Creative Mode.
3.	Simulation: An interactive city-building and urban planning environment.
CIVITAS is not intended to replicate every feature of existing video conferencing platforms. Its differentiation is spatial collaboration: people communicate by interacting with the same virtual environment.
BAB V2. Product Vision
Make virtual collaboration more visual, interactive, and engaging by turning a digital city into a shared workspace.
BAB VI3. Target Users
BAB VIIPrimary users
•	University students and academic groups.
•	Urban planning students.
•	Architecture and design teams.
•	Organizations and communities.
•	Remote collaboration teams.
•	Educators and instructors.
BAB VIIISecondary users
•	Urban planning enthusiasts.
•	Simulation and creative communities.
•	Researchers exploring urban environments.
BAB IX4. Product Principles
1.	Accessibility first: users with low-end devices must be able to participate.
2.	Performance over visual complexity.
3.	Real-time collaboration must be reliable.
4.	AI should provide meaningful functionality, not decorative features.
5.	The interface must remain understandable for non-technical users.
6.	The product must work on modern desktop and mobile browsers.
7.	Core functionality must not depend on expensive AI services.
8.	The city should remain interactive even when AI services are unavailable.
 
BAB XPART II — USER EXPERIENCE
BAB XI5. Main User Journey
BAB XII5.1 Landing Page
A clean, modern landing page introducing CIVITAS.
Required elements:
•	CIVITAS logo and branding.
•	Product introduction.
•	Interactive city preview.
•	Features overview.
•	Sign in / Sign up.
•	Create a room CTA.
•	Join an existing room CTA.
Avoid rendering a full 3D city in the landing page by default. Use a static preview or lightweight animation to preserve performance.
BAB XIII5.2 Authentication
Users can:
•	Register using email and password.
•	Sign in.
•	Sign out.
•	Update their profile.
•	Select a username.
•	Upload an avatar.
•	Join a room through an invitation link.
Guest access should be supported for invited participants where room permissions allow it.
BAB XIV5.3 Dashboard
The dashboard should contain:
•	Welcome message.
•	User profile.
•	Recent rooms.
•	Create new city.
•	Join city using invitation code.
•	Available public demo environments.
•	Recent activity.
•	Room ownership and membership information.
BAB XV5.4 Create City / Room
Users can create a new virtual environment.
Required settings:
•	Room name.
•	Room description.
•	Room visibility: private or public.
•	Maximum participants.
•	Environment template.
•	World size.
•	Access permissions.
Initial environment templates:
•	Modern City.
•	Small Town.
•	University Campus.
•	Transportation Hub.
•	Empty Sandbox.
BAB XVI5.5 Join City
Users can join using:
•	Invitation link.
•	Room code.
•	Public room directory.
Upon entering:
1.	Validate room access.
2.	Initialize the appropriate rendering mode.
3.	Load the city scene.
4.	Connect to the multiplayer server.
5.	Spawn the user's avatar.
6.	Synchronize room state.
7.	Display other participants.
Provide an explicit loading screen with progress feedback.
 
BAB XVIIPART III — CORE FEATURES
BAB XVIII6. 3D City Environment
The 3D environment is the primary interaction surface.
BAB XIX6.1 Navigation
Desktop:
•	WASD movement.
•	Mouse camera control.
•	Scroll to zoom.
•	Click to select objects.
•	Keyboard shortcuts.
Mobile:
•	Virtual joystick.
•	Touch drag camera rotation.
•	Pinch to zoom.
•	Tap to select.
•	Contextual interaction buttons.
BAB XX6.2 Camera Modes
Support:
•	Third-person camera.
•	Top-down camera.
•	Free camera.
•	Overview camera.
Mobile devices should default to an optimized top-down or isometric camera.
BAB XXI6.3 Environment
The city should contain:
•	Roads.
•	Sidewalks.
•	Buildings.
•	Trees.
•	Streetlights.
•	Public spaces.
•	Parks.
•	Vehicles.
•	Public transportation infrastructure.
Use modular and reusable 3D assets.
Do not attempt photorealistic rendering for the MVP.
Preferred visual style:
•	Low-poly or optimized stylized 3D.
•	Clean geometry.
•	Consistent materials.
•	Soft lighting.
•	Readable colors.
•	Minimal post-processing.
BAB XXII7. Avatar System
Each user is represented by an avatar.
Features:
•	Avatar selection.
•	Username display.
•	Movement animation.
•	Idle animation.
•	Walking animation.
•	Simple interaction animations.
•	Online status.
Avatar optimization:
•	Low polygon count.
•	Reusable materials.
•	Shared animation assets.
•	Limited animation complexity.
The system must display other participants without requiring expensive character rendering.
BAB XXIII8. Multiplayer System
Multiplayer functionality is a fundamental feature.
BAB XXIV8.1 Room Management
•	Create room.
•	Join room.
•	Leave room.
•	Room ownership.
•	Room permissions.
•	Participant list.
•	Room capacity.
•	Invitation links.
BAB XXV8.2 Real-Time Synchronization
Synchronize:
•	Avatar positions.
•	Avatar rotations.
•	Avatar animation states.
•	Object placement.
•	Object transformations.
•	Object deletion.
•	Room interactions.
•	User presence.
Use server-authoritative validation for important world modifications.
Do not synchronize the entire 3D scene every frame.
Use efficient state updates, interpolation, and controlled update frequencies.
BAB XXVI8.3 User Presence
Display:
•	Online users.
•	Current room participants.
•	User names.
•	Speaking indicators.
•	Current activity.
•	User location within the city.
BAB XXVII8.4 Multiplayer Capacity
Initial target:
•	5–10 concurrent users per room.
Architecture should permit future scaling, but do not optimize prematurely for hundreds of simultaneous users.
BAB XXVIII9. Communication System
CIVITAS should offer communication functionality comparable to modern meeting applications.
BAB XXIX9.1 Voice Chat
•	Enable/disable microphone.
•	Mute/unmute.
•	Speaking indicators.
•	Device selection where supported.
•	Voice connection status.
BAB XXX9.2 Video Call
•	Enable/disable camera.
•	Video participant panel.
•	Camera status.
•	Participant video tiles.
•	Optional floating video panel.
•	No forced camera activation.
Video must be optional.
BAB XXXI9.3 Spatial Audio
Implement proximity-based audio as an advanced feature.
Concept:
•	Users nearby can hear each other.
•	Distance affects audio volume.
•	Users outside a defined radius cannot hear local conversations.
•	Users can enter designated meeting spaces with isolated communication channels.
Spatial audio must be configurable and should not interfere with normal meeting audio.
BAB XXXII9.4 Text Chat
•	Room chat.
•	Private messaging as a future feature.
•	System notifications.
•	User join/leave messages.
BAB XXXIII9.5 Screen Sharing
Allow users to share their desktop or application screen through browser-supported screen capture.
Screen sharing should appear in a dedicated presentation panel.
Do not force mobile devices to share screens when the browser does not support it.
BAB XXXIV9.6 Meeting Controls
Persistent meeting toolbar:
•	Microphone.
•	Camera.
•	Screen sharing.
•	Chat.
•	Participants.
•	Settings.
•	Leave room.
Use LiveKit or another suitable WebRTC-based service for media communication.
 
BAB XXXVPART IV — CITY SIMULATION
BAB XXXVI10. Building System
Users can interact with the city through a building editor.
Required operations:
•	Place buildings.
•	Select buildings.
•	Move buildings.
•	Rotate buildings.
•	Scale supported objects.
•	Change building appearance.
•	Delete objects.
Use grid snapping for easier placement.
Implement object selection and transformation handles.
BAB XXXVII10.1 Initial Asset Library
Provide a small but consistent asset collection:
•	Residential building.
•	Office building.
•	Commercial building.
•	School.
•	Hospital.
•	Park.
•	Road segments.
•	Trees.
•	Street furniture.
Focus on asset quality and reusability rather than asset quantity.
BAB XXXVIII11. Transportation Simulation
Transportation should be a core demonstration feature.
Initial components:
•	Road network.
•	Bus stops.
•	Bus routes.
•	Basic vehicles.
•	Transportation nodes.
•	Route visualization.
Future components:
•	MRT.
•	LRT.
•	Railways.
•	Pedestrian simulation.
•	Traffic density.
•	Passenger demand.
•	Multimodal transportation networks.
Users should be able to:
•	Place transportation stops.
•	Connect stops into routes.
•	Visualize route lines.
•	Move simulated vehicles along predefined paths.
For the MVP, vehicle movement can use simplified path-based animation.
Do not attempt a scientifically accurate traffic model in the first release.
BAB XXXIX12. Simulation Controls
Provide a simulation control panel:
•	Start simulation.
•	Pause simulation.
•	Reset simulation.
•	Simulation speed.
•	Time of day.
•	Weather preset.
Initial simulation examples:
•	Vehicles moving on roads.
•	Basic population movement.
•	Day/night lighting changes.
Simulation state must be distinguishable from the underlying editable city configuration.
 
BAB XLPART V — AI INTEGRATION
BAB XLI13. AI City Assistant
The AI assistant helps users interact with their environment using natural language.
Example prompts:
•	"Create a modern office building."
•	"Add a park near the residential area."
•	"Create a bus route connecting these three stops."
•	"Suggest a better transportation layout."
•	"Analyze the distribution of public facilities."
BAB XLII13.1 AI Asset Generation
For the MVP, use AI to generate structured object configurations rather than requiring expensive real-time 3D model generation.
Example:
User prompt:
"Create a modern office building with ten floors."
AI output:
{
  "type": "office_building",
  "floors": 10,
  "style": "modern",
  "material": "glass",
  "position": {
    "x": 10,
    "y": 0,
    "z": 15
  },
  "scale": {
    "x": 1,
    "y": 1,
    "z": 1
  }
}
The application validates this output and converts it into a predefined 3D asset configuration.
AI must never directly execute arbitrary code inside the 3D scene.
BAB XLIII13.2 AI City Advisor
AI should be able to:
•	Suggest urban improvements.
•	Identify potential transportation gaps.
•	Recommend facility placement.
•	Explain basic simulation results.
•	Summarize design decisions.
Clearly distinguish AI suggestions from verified simulation results.
BAB XLIV13.3 AI Availability
The core application must continue working without AI.
If an API is unavailable:
•	Display an understandable error.
•	Preserve the user's work.
•	Allow manual editing.
•	Avoid blocking the entire application.
 
BAB XLVPART VI — MOBILE & LOW-END DEVICE OPTIMIZATION
BAB XLVI14. Accessibility and Device Compatibility
This is a mandatory product requirement, not a secondary enhancement.
CIVITAS must be usable on:
•	Desktop computers.
•	Laptops.
•	Mid-range Android devices.
•	Entry-level Android devices.
•	iPhones.
•	Tablets.
Target low-end mobile devices with approximately:
•	2–4 GB RAM.
•	Entry-level or older mobile GPUs.
•	Limited processing power.
•	Unstable or slow internet connections.
These are design targets, not guarantees for every device.
BAB XLVII14.1 Adaptive Rendering
Implement at least three rendering profiles.
Low Quality
•	Low polygon assets.
•	Reduced render resolution.
•	No real-time shadows.
•	No expensive post-processing.
•	Limited particle effects.
•	Reduced draw calls.
•	Simplified lighting.
•	Limited visible objects.
Balanced Quality
•	Moderate render resolution.
•	Basic shadows where supported.
•	Moderate view distance.
•	Standard environmental details.
High Quality
•	Higher render resolution.
•	Improved lighting.
•	More environmental details.
•	Additional visual effects.
Allow users to manually select a quality profile.
BAB XLVIII14.2 Automatic Quality Detection
At startup:
1.	Detect WebGL support.
2.	Check device capabilities where available.
3.	Initialize a conservative quality profile.
4.	Monitor frame rate and rendering performance.
5.	Reduce quality when performance deteriorates.
6.	Allow manual override.
Never assume that device type alone determines performance.
BAB XLIX14.3 Mobile Experience
Mobile users must not receive a broken or unusable version of the desktop interface.
Provide a dedicated responsive experience.
Mobile priorities:
•	Join rooms.
•	View the city.
•	Navigate using touch controls.
•	Communicate through voice and video.
•	Use chat.
•	Select and inspect objects.
•	Make basic building modifications.
•	View other participants.
•	Access presentation mode.
Advanced city editing can be simplified on mobile.
BAB L14.4 Mobile Fallback
If a device cannot render the full 3D scene smoothly, provide a lightweight 2D or simplified isometric mode.
This mode must still allow users to:
•	Join the same room.
•	See participant locations.
•	Chat.
•	Communicate.
•	Inspect city objects.
•	Interact with supported objects.
Mobile users must participate in the same shared world, not a disconnected version of the application.
BAB LI14.5 Performance Targets
Target metrics:
Metric	Target
Initial landing page	Under 3 seconds on a reasonable connection
Low-end mobile rendering	Target 25–30 FPS
Desktop rendering	Target 50–60 FPS
Initial 3D scene	Progressive loading
Network synchronization	Target 100–200 ms under reasonable conditions
Mobile layout	No horizontal overflow
Application	No mandatory native installation
Targets should be measured on actual devices and representative network conditions.
BAB LII14.6 Optimization Techniques
Use:
•	InstancedMesh for repeated objects.
•	Level of Detail (LOD).
•	Frustum culling.
•	Occlusion strategies where appropriate.
•	Texture compression.
•	Compressed 3D assets.
•	Lazy loading.
•	Dynamic asset loading.
•	Shared geometry and materials.
•	Reduced network payloads.
•	Debounced or throttled updates.
•	Progressive loading.
Avoid:
•	Excessive real-time shadows.
•	Huge uncompressed textures.
•	Too many individual mesh draw calls.
•	Rendering off-screen content unnecessarily.
•	Unnecessary React re-renders.
•	Sending full scene state repeatedly.
BAB LIII14.7 PWA Support
Provide Progressive Web App support where practical.
Requirements:
•	Installable application.
•	Application icon.
•	Appropriate manifest.
•	Offline landing page.
•	Cached static assets.
•	Reconnection handling.
Multiplayer and live communication still require an internet connection.
 
BAB LIVPART VII — UI/UX DESIGN
BAB LV15. Visual Direction
CIVITAS should feel like a polished modern productivity platform combined with an interactive simulation environment.
Design characteristics:
•	Modern.
•	Minimal.
•	Professional.
•	Spatial.
•	Accessible.
•	Clean visual hierarchy.
Avoid:
•	Excessively colorful gradients.
•	Overly complicated dashboards.
•	Game-like HUD clutter.
•	Excessive glassmorphism.
•	Tiny mobile controls.
BAB LVI15.1 Desktop Layout
Main layout:
•	Top navigation: room name, participants, settings.
•	Main area: interactive 3D city.
•	Left sidebar: city hierarchy and asset library.
•	Right sidebar: selected object properties and AI assistant.
•	Bottom toolbar: movement, building tools, simulation controls.
•	Floating panel: video participants.
•	Chat panel: collapsible.
BAB LVII15.2 Mobile Layout
Main layout:
•	Full-screen city viewport.
•	Compact top bar.
•	Bottom navigation.
•	Floating movement joystick.
•	Collapsible object controls.
•	Expandable chat.
•	Compact participant panel.
•	Accessible communication controls.
Avoid placing too many controls over the 3D viewport.
BAB LVIII15.3 Design System
Define:
•	Color tokens.
•	Typography scale.
•	Spacing scale.
•	Component states.
•	Button variants.
•	Modal patterns.
•	Form patterns.
•	Navigation patterns.
•	Responsive breakpoints.
Ensure sufficient contrast and readable text sizes.
 
BAB LIXPART VIII — TECHNICAL ARCHITECTURE
BAB LX16. Recommended Technology Stack
BAB LXIFrontend
•	Next.js.
•	React.
•	TypeScript.
•	Tailwind CSS.
•	React Three Fiber.
•	Three.js.
•	Zustand.
BAB LXII3D
•	Three.js.
•	React Three Fiber.
•	Drei where appropriate.
•	GLTF/GLB assets.
•	Draco or other suitable compression.
BAB LXIIIBackend
•	Node.js.
•	PostgreSQL.
•	Supabase Authentication.
•	Supabase Storage.
•	Realtime infrastructure where appropriate.
BAB LXIVMultiplayer
•	Colyseus or a suitable authoritative WebSocket server.
•	Socket.IO where its capabilities fit the use case.
BAB LXVCommunication
•	LiveKit.
•	WebRTC.
BAB LXVIAI
•	Gemini API or another interchangeable LLM provider.
BAB LXVIIDeployment
•	Vercel or another suitable frontend hosting provider.
•	Dedicated backend hosting for persistent multiplayer servers.
•	Managed PostgreSQL.
•	Object storage or Supabase Storage.
Do not assume serverless functions are appropriate for persistent WebSocket or game-room connections.
BAB LXVIII17. Architectural Separation
Separate the application into these logical modules:
1.	Authentication.
2.	Dashboard.
3.	Room management.
4.	3D rendering.
5.	World state.
6.	Multiplayer synchronization.
7.	Avatar management.
8.	Communication.
9.	City editor.
10.	Transportation simulation.
11.	AI assistant.
12.	Asset management.
Each module should have a clear responsibility and interface.
BAB LXIX18. Database Design
Suggested core tables:
BAB LXXprofiles
•	id
•	username
•	display_name
•	avatar_url
•	created_at
•	updated_at
BAB LXXIrooms
•	id
•	owner_id
•	name
•	description
•	visibility
•	environment_template
•	max_participants
•	created_at
•	updated_at
BAB LXXIIroom_members
•	id
•	room_id
•	user_id
•	role
•	joined_at
BAB LXXIIIcity_scenes
•	id
•	room_id
•	scene_data
•	version
•	updated_at
BAB LXXIVcity_objects
•	id
•	room_id
•	object_type
•	asset_id
•	position
•	rotation
•	scale
•	properties
•	created_by
•	created_at
•	updated_at
BAB LXXVcity_routes
•	id
•	room_id
•	name
•	transport_type
•	route_data
•	created_by
BAB LXXVIroom_messages
•	id
•	room_id
•	sender_id
•	content
•	message_type
•	created_at
BAB LXXVIIroom_activity
•	id
•	room_id
•	user_id
•	activity_type
•	metadata
•	created_at
BAB LXXVIIIai_requests
•	id
•	user_id
•	room_id
•	prompt
•	result
•	status
•	created_at
Use appropriate foreign keys, indexes, constraints, and access policies.
Do not store high-frequency avatar movement updates as individual permanent database rows.
Use an appropriate real-time state layer for transient information.
 
BAB LXXIXPART IX — SECURITY & RELIABILITY
BAB LXXX19. Security Requirements
•	Authentication required for protected rooms.
•	Room-level permissions.
•	Role-based access.
•	Validate every world modification.
•	Sanitize user-generated text.
•	Validate AI-generated JSON.
•	Rate-limit expensive operations.
•	Protect API keys using server-side environment variables.
•	Never expose privileged database keys to the client.
•	Apply appropriate database access policies.
•	Validate file uploads.
•	Prevent unauthorized room access.
•	Implement basic abuse prevention.
BAB LXXXIRoles
Owner
•	Create and delete rooms.
•	Manage permissions.
•	Manage participants.
•	Configure the environment.
Editor
•	Modify city objects.
•	Add buildings and infrastructure.
•	Participate in simulations.
Participant
•	Move around.
•	Communicate.
•	Inspect objects.
•	Participate in meetings.
Viewer
•	Observe the city.
•	Follow presentations.
•	Communicate only when permissions allow.
BAB LXXXII20. Reliability
•	Automatic reconnection.
•	Graceful handling of network interruptions.
•	Preserve saved city state.
•	Avoid losing edits during temporary disconnections.
•	Display connection status.
•	Handle failed AI requests.
•	Handle failed video connections independently from the city engine.
 
BAB LXXXIIIPART X — MVP SCOPE
BAB LXXXIV21. MVP Requirements
The initial release should demonstrate a coherent working product.
BAB LXXXVMust Have
•	Landing page.
•	Authentication.
•	Dashboard.
•	Create and join room.
•	Invitation links.
•	Shared 3D city environment.
•	Avatar movement.
•	Multiplayer synchronization.
•	User presence.
•	Room chat.
•	Voice communication.
•	Basic video calling.
•	Basic city editing.
•	Object placement and transformation.
•	Low-end mobile rendering profile.
•	Responsive mobile interface.
•	AI-assisted building configuration.
•	Save and reload city state.
BAB LXXXVIShould Have
•	Screen sharing.
•	Simulation controls.
•	Basic vehicle movement.
•	Transportation routes.
•	Spatial audio.
•	PWA installation.
•	2D mobile fallback.
BAB LXXXVIICould Have
•	AI city advisor.
•	Population simulation.
•	Weather simulation.
•	Advanced building customization.
•	Multiple city environments.
•	Meeting summaries.
•	Export scene to GLB.
BAB LXXXVIIINot in Initial MVP
•	Photorealistic cities.
•	Large-scale MMO infrastructure.
•	Fully autonomous city simulation.
•	Complex economic simulation.
•	AI-generated production-quality 3D meshes.
•	Native iOS and Android applications.
•	Hundreds of simultaneous participants.
 
BAB LXXXIXPART XI — DEVELOPMENT ROADMAP
BAB XC22. Suggested Development Phases
BAB XCIPhase 1 — Foundation
•	Repository setup.
•	Design system.
•	Authentication.
•	Dashboard.
•	Room creation.
•	Room joining.
BAB XCIIPhase 2 — 3D Environment
•	Three.js integration.
•	Scene management.
•	City environment.
•	Camera controls.
•	Avatar system.
•	Touch navigation.
BAB XCIIIPhase 3 — Multiplayer
•	Room server.
•	State synchronization.
•	Avatar synchronization.
•	User presence.
•	Reconnection.
BAB XCIVPhase 4 — Communication
•	LiveKit integration.
•	Microphone.
•	Camera.
•	Participant panel.
•	Chat.
•	Screen sharing.
BAB XCVPhase 5 — City Editor
•	Asset library.
•	Object selection.
•	Placement.
•	Transformation.
•	Scene persistence.
BAB XCVIPhase 6 — AI
•	AI assistant.
•	Structured scene generation.
•	JSON validation.
•	AI-generated city configurations.
BAB XCVIIPhase 7 — Simulation
•	Transportation routes.
•	Vehicle movement.
•	Simulation controls.
•	Basic environment changes.
BAB XCVIIIPhase 8 — Optimization
•	Mobile performance.
•	Adaptive rendering.
•	2D fallback.
•	Network optimization.
•	Testing.
•	Deployment.
 
BAB XCIXPART XII — ACCEPTANCE CRITERIA
BAB C23. Definition of Done
The MVP is considered demonstrable when:
1.	A user can register and log in.
2.	A user can create a city room.
3.	Another user can join using an invitation link.
4.	At least five users can participate in a shared room under the test environment.
5.	Users can see one another's avatars.
6.	Avatar movement is synchronized.
7.	Users can communicate using voice.
8.	Users can optionally activate video.
9.	Users can chat.
10.	Users can place and manipulate buildings.
11.	Changes are visible to other participants.
12.	City modifications can be saved and reloaded.
13.	AI can convert a supported natural-language request into a validated building configuration.
14.	The application remains usable on a representative low-end Android device.
15.	Mobile users can participate without needing desktop-only controls.
16.	Temporary network interruptions do not permanently destroy saved city data.
BAB CI24. Testing Strategy
Test on:
•	Desktop Chrome.
•	Desktop Firefox.
•	Android Chrome on a low-end device.
•	Android Chrome on a mid-range device.
•	iPhone Safari.
•	Tablet browser.
Test scenarios:
•	Multiple users joining simultaneously.
•	User disconnection and reconnection.
•	Slow internet.
•	AI provider unavailable.
•	Video provider unavailable.
•	Large numbers of visible city objects.
•	Simultaneous object editing.
•	Mobile screen resizing and orientation changes.
Record actual performance measurements instead of claiming compatibility based only on emulation.
 
BAB CIIPART XIII — PRODUCT SUCCESS METRICS
BAB CIII25. Initial Success Metrics
•	Successful room creation rate.
•	Successful room joining rate.
•	Average number of active participants per room.
•	Multiplayer synchronization reliability.
•	Average session duration.
•	Number of city objects created.
•	Successful AI generation rate.
•	Mobile session completion rate.
•	Crash and disconnection rate.
•	Performance across device categories.
The primary product success metric is:
Successful collaborative sessions: sessions where at least two users join the same environment, communicate, and complete at least one shared activity.
 
BAB CIVPART XIV — IMPLEMENTATION GUIDELINES
BAB CV26. Engineering Rules
1.	Build functional features rather than static mockups.
2.	Use TypeScript throughout the application.
3.	Keep the architecture modular.
4.	Avoid unnecessary dependencies.
5.	Do not place secrets in frontend code.
6.	Use reusable components.
7.	Optimize 3D assets.
8.	Keep mobile performance as a first-class concern.
9.	Validate all server-side operations.
10.	Use environment variables for configuration.
11.	Document setup and deployment.
12.	Provide loading, empty, error, and success states.
13.	Never silently replace a working feature with a placeholder.
14.	Do not claim an integration works before testing it.
15.	Avoid overengineering beyond the MVP.
 
BAB CVIPART XV — PRODUCT NORTH STAR
CIVITAS should not be evaluated solely by how impressive its 3D graphics look.
It should be evaluated by whether people can genuinely work together inside a shared virtual city.
The city is the interface.
The users are the participants.
The simulation is the collaboration medium.
The AI is the intelligence layer.
CIVITAS — Build Places. Bring People Together.
 
BAB CVIIAPPENDIX A — MASTER PROMPT FOR CLAUDE
The following is the implementation instruction. Use it together with the entire PRD above.
 
BAB CVIIIROLE
You are acting as a senior full-stack software architect, product engineer, real-time systems engineer, 3D graphics engineer, and UI/UX implementation specialist.
Your assignment is to design and build CIVITAS, an AI-powered, multiplayer, collaborative 3D city simulation platform.
You are not building a simple landing page or a static prototype.
You are building a functional, extensible web application.
Follow the PRD as the source of truth.
BAB CIX1. FIRST: INSPECT BEFORE BUILDING
Before writing or modifying code:
1.	Inspect the existing repository.
2.	Identify the current framework and project structure.
3.	Inspect installed dependencies.
4.	Identify existing functionality.
5.	Identify existing design conventions.
6.	Inspect environment variables and configuration without exposing secret values.
7.	Identify missing infrastructure.
8.	Report any architectural conflicts with the PRD.
Do not delete or overwrite existing working functionality without justification.
If the repository is empty, initialize a suitable project.
If an existing implementation is present, preserve and extend it.
BAB CX2. PRODUCT REQUIREMENTS
Build CIVITAS as a unified application with these major experiences:
•	Authentication.
•	Dashboard.
•	City rooms.
•	Shared 3D environments.
•	Avatar navigation.
•	Real-time multiplayer.
•	Voice and video communication.
•	Room chat.
•	City building and object manipulation.
•	AI-assisted scene generation.
•	Basic urban transportation simulation.
•	Responsive mobile experience.
The product must work on desktop and mobile browsers.
BAB CXI3. CRITICAL: LOW-END DEVICE SUPPORT
This is a non-negotiable requirement.
Do not design the application exclusively for high-end desktops.
Implement a mobile-first performance strategy.
Required:
•	Adaptive rendering profiles.
•	Low, balanced, and high graphics settings.
•	Simplified geometry.
•	Instanced meshes.
•	Frustum culling.
•	LOD where appropriate.
•	Texture compression.
•	Progressive loading.
•	Reduced draw calls.
•	Reduced shadow complexity.
•	Efficient state synchronization.
•	Responsive touch controls.
•	Top-down or isometric mobile camera.
•	2D or simplified rendering fallback.
The application must remain usable if a device cannot render the full 3D environment.
A mobile user must still be able to join the same multiplayer room, communicate, see other participants, inspect objects, and perform supported interactions.
Never force a mobile device to load unnecessary high-resolution assets.
Do not assume that a mobile browser can run the same graphical settings as desktop.
BAB CXII4. TECHNICAL ARCHITECTURE
Use the following preferred technologies:
•	Next.js.
•	React.
•	TypeScript.
•	Tailwind CSS.
•	Three.js.
•	React Three Fiber.
•	Zustand.
•	PostgreSQL.
•	Supabase Authentication.
•	Node.js.
•	Colyseus or a suitable real-time WebSocket architecture.
•	LiveKit for voice/video.
•	Gemini API or another interchangeable LLM provider.
You may recommend alternatives if there is a clear technical reason.
Do not introduce unnecessary dependencies.
Separate persistent database state from transient real-time state.
Do not use serverless request handlers as a substitute for persistent multiplayer infrastructure.
Keep the 3D engine, collaboration system, media communication, and AI service logically independent.
BAB CXIII5. IMPLEMENTATION PRIORITIES
Build in this order:
Priority 1 — Functional foundation
•	Application structure.
•	Authentication.
•	Dashboard.
•	Room management.
•	Responsive design.
Priority 2 — Interactive world
•	3D city.
•	Camera controls.
•	Avatar.
•	Movement.
•	Touch navigation.
Priority 3 — Multiplayer
•	Real-time connections.
•	Shared room state.
•	Avatar synchronization.
•	Presence.
•	Reconnection.
Priority 4 — Communication
•	Voice.
•	Video.
•	Chat.
•	Screen sharing.
Priority 5 — City editor
•	Asset library.
•	Object selection.
•	Placement.
•	Rotation.
•	Scaling.
•	Deletion.
•	Save/load.
Priority 6 — AI
•	Natural-language commands.
•	Structured JSON output.
•	Schema validation.
•	Safe scene manipulation.
Priority 7 — Simulation
•	Road networks.
•	Transportation routes.
•	Vehicle animation.
•	Simulation controls.
Priority 8 — Performance
•	Low-end Android testing.
•	Adaptive quality.
•	Mobile fallback.
•	Network optimization.
BAB CXIV6. UI/UX EXPECTATIONS
Create a polished, production-oriented interface.
The visual direction should be modern, minimal, professional, and spatial.
Desktop:
•	Main 3D viewport.
•	Left asset sidebar.
•	Right properties panel.
•	Top room navigation.
•	Bottom interaction toolbar.
•	Floating communication panel.
Mobile:
•	Full-screen interactive environment.
•	Compact navigation.
•	Touch-based movement.
•	Collapsible tool panels.
•	Accessible communication controls.
•	No horizontal overflow.
Do not simply shrink the desktop layout to fit mobile.
Design mobile interactions intentionally.
BAB CXV7. REAL-TIME ENGINEERING
Implement proper synchronization.
Requirements:
•	Authoritative validation for important changes.
•	Efficient state updates.
•	Interpolation of remote movement.
•	Reconnection handling.
•	Room isolation.
•	Permission validation.
•	Avoid broadcasting the entire world every frame.
Use WebRTC-based media infrastructure for voice/video.
Do not confuse multiplayer game-state synchronization with media communication.
BAB CXVI8. AI IMPLEMENTATION
AI must operate through structured, validated commands.
Example user request:
"Create a five-floor office building near the central park."
Expected workflow:
1.	Parse user intent.
2.	Generate structured configuration.
3.	Validate the configuration.
4.	Check user permissions.
5.	Execute a supported scene operation.
6.	Synchronize the resulting change.
7.	Confirm the action.
Never allow AI to execute arbitrary JavaScript or unrestricted scene operations.
Provide a deterministic manual editing alternative.
BAB CXVII9. ENGINEERING QUALITY
Maintain:
•	Strong TypeScript types.
•	Clear folder structure.
•	Reusable components.
•	Modular services.
•	Error boundaries.
•	Loading states.
•	Empty states.
•	Error handling.
•	Accessible controls.
•	Consistent naming.
•	Documentation.
Never create fake functionality and present it as real.
If a third-party integration requires API credentials, implement its integration interface, document the required environment variables, and explain the setup process.
Do not invent API credentials.
If a service is unavailable, explain the limitation and provide a clearly labeled development fallback.
BAB CXVIII10. DEVELOPMENT WORKFLOW
Do not attempt to implement every feature in one enormous code-generation operation.
Work incrementally.
For each phase:
1.	Inspect the relevant code.
2.	Define the implementation.
3.	Make the changes.
4.	Run available type checks.
5.	Run linting.
6.	Run tests where applicable.
7.	Fix errors.
8.	Verify the feature.
9.	Update documentation.
10.	Summarize what is completed and what remains.
Do not claim successful tests unless they have actually been executed.
Keep the application runnable after each development phase.
If a major architectural decision is unclear, explain the trade-offs and choose a reasonable MVP default rather than blocking the entire project with excessive questions.
BAB CXIX11. INITIAL TASK
Start by analyzing the repository and preparing:
1.	Architecture overview.
2.	Recommended folder structure.
3.	Dependency plan.
4.	Database schema.
5.	Real-time communication architecture.
6.	3D rendering architecture.
7.	Mobile optimization strategy.
8.	Development phases.
9.	Potential technical risks.
Then implement Phase 1.
Do not build a giant static mockup and call it complete.
The objective is a real, testable, working product.
BAB CXXFINAL INSTRUCTION
Treat CIVITAS as a serious product.
Prioritize working functionality, reliable multiplayer behavior, accessible mobile performance, and coherent architecture.
The most important requirement is that a user on a low-end Android device can join a city with users on powerful desktop computers and participate meaningfully in the same collaborative experience.
Build the foundation correctly before adding unnecessary complexity.
Product: CIVITAS — The City Is Your Meeting Room.

 REVISED PRD

BAB CXXICIVITAS — TECH STACK REVISION & ENGINEERING DIRECTIVE
This document supersedes the previous technology stack recommendations in the CIVITAS PRD.
BAB CXXII1. Frontend Architecture
Use the following primary frontend stack:
•	React
•	Vite
•	TypeScript
•	Tailwind CSS
•	Three.js
•	React Three Fiber
•	@react-three/drei
•	GSAP
•	Zustand
The primary frontend must be a React + Vite application.
Do not use Next.js as the primary frontend framework unless a specific technical requirement justifies changing this decision.
Do not mix React and Svelte in the same frontend application.
Svelte + Vite may be considered as an alternative architecture, but React + Vite is the selected default.
BAB CXXIII2. Three.js Architecture
Three.js is the core graphics engine of CIVITAS.
Use React Three Fiber to integrate Three.js into React.
Use Drei for appropriate utilities, including:
•	Camera controls.
•	Environment helpers.
•	Asset loading.
•	Performance monitoring.
•	Reusable 3D components.
Organize the 3D engine independently from normal React interface components.
Suggested structure:
src/
├── app/
│   ├── App.tsx
│   ├── routes/
│   └── providers/
│
├── components/
│   ├── ui/
│   ├── layout/
│   └── communication/
│
├── features/
│   ├── authentication/
│   ├── dashboard/
│   ├── rooms/
│   ├── city-editor/
│   ├── multiplayer/
│   ├── communication/
│   ├── simulation/
│   └── ai-assistant/
│
├── engine/
│   ├── core/
│   ├── scenes/
│   ├── cameras/
│   ├── controls/
│   ├── objects/
│   ├── assets/
│   ├── materials/
│   ├── lighting/
│   ├── physics/
│   ├── optimization/
│   └── mobile/
│
├── services/
│   ├── api/
│   ├── auth/
│   ├── realtime/
│   ├── livekit/
│   └── ai/
│
├── stores/
├── hooks/
├── animations/
├── styles/
├── types/
└── utils/
Adapt the folder structure when necessary, but preserve separation of responsibilities.
BAB CXXIV3. GSAP Animation
Use GSAP for:
•	Page transitions.
•	Dashboard interactions.
•	Sidebar transitions.
•	Modal animations.
•	Navigation transitions.
•	Loading sequences.
•	Micro-interactions.
•	Interface feedback.
Do not use GSAP indiscriminately for every animation.
Use Three.js animation systems or React Three Fiber's frame loop for continuous 3D interactions.
Ensure animations are performant and respect reduced-motion preferences.
Clean up GSAP timelines and animation contexts when components unmount.
BAB CXXV4. State Management
Use Zustand for shared application state.
Separate:
•	UI state.
•	Authentication state.
•	Room state.
•	Local interaction state.
•	City editing state.
•	Simulation state.
Do not store every high-frequency 3D frame update in React global state.
Keep frequently changing graphics data within the 3D engine where possible.
BAB CXXVI5. Performance Requirements
The 3D engine must support adaptive quality.
Implement:
•	Low, balanced, and high rendering profiles.
•	Dynamic resolution scaling where appropriate.
•	InstancedMesh.
•	LOD.
•	Frustum culling.
•	Compressed GLTF/GLB assets.
•	Lazy loading.
•	Texture optimization.
•	Reduced draw calls.
•	Efficient object management.
Mobile devices must use simplified rendering and touch-friendly navigation.
Provide a lightweight fallback if full WebGL rendering is unavailable or too slow.
Do not let heavy GSAP animations, unnecessary React renders, or excessive 3D assets degrade mobile performance.
BAB CXXVII6. Backend and Real-Time Infrastructure
Keep the backend independent from the frontend build system.
Recommended:
•	Node.js.
•	TypeScript.
•	PostgreSQL.
•	Supabase Auth.
•	Colyseus for multiplayer state synchronization.
•	LiveKit for voice/video/screen sharing.
•	Gemini API behind a server-side AI service.
Use a separate backend deployment for persistent multiplayer connections.
Do not depend on Vite as a backend server.
BAB CXXVIII7. Development Rules
Before implementation:
1.	Inspect the repository.
2.	Confirm existing dependencies.
3.	Identify the current architecture.
4.	Propose the implementation plan.
5.	Avoid unnecessary framework changes.
Build the application incrementally.
Run TypeScript checks, linting, and tests where available.
Verify real device performance.
Do not create placeholder integrations and describe them as completed features.
BAB CXXIX8. Architecture Decision
The default CIVITAS frontend stack is:
React + Vite + TypeScript + Three.js + React Three Fiber + GSAP + Zustand.
The core product must remain modular, performant, mobile-accessible, and extensible.
The primary engineering priority is delivering a reliable shared 3D city environment across desktop and low-end mobile devices.

