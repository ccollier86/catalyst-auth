# Universal Architecture & Development Process Guide

## Overview

This is a **project-agnostic, technology-agnostic** guide to building maintainable software systems. This methodology works for:

- Any UI framework (React, Vue, Svelte, Angular, vanilla JS, mobile, desktop)
- Any backend (Node, Python, Go, Java, C#, Ruby, etc.)
- Any paradigm (OOP, functional, reactive)
- Any scale (small apps to enterprise systems)

The three core principles are:

1. **System of Record (SOR)** - Single source of truth
2. **Separation of Duties (SOD)** - One responsibility per unit
3. **Dependency Injection (DI)** - Dependencies flow inward

---

## Core Principle 1: System of Record (SOR)

### The Concept

**Every piece of data has exactly ONE authoritative source.**

Never duplicate state. Never cache truth. Always query the source.

### The Rule

```
If Component A owns the data:
- Component A stores it
- Component A modifies it
- All others query Component A
- No one else stores a copy
```

### Visual Example

**❌ WRONG - Duplicated State:**

```
┌──────────────┐         ┌──────────────┐
│ ComponentA   │         │ ComponentB   │
│ data: [...]  │         │ data: [...]  │ ← DUPLICATE!
└──────────────┘         └──────────────┘
```

**Problem:** Data changes in A, B is stale. Now you need sync logic. Bugs inevitable.

**✅ CORRECT - Single Source:**

```
┌──────────────┐         ┌──────────────┐
│ ComponentA   │ ──────→ │ ComponentB   │
│ data: [...]  │  query  │ (queries A)  │
└──────────────┘         └──────────────┘
  (SOR - owns it)         (derived - reads it)
```

**Benefit:** One source of truth. B always gets current data. Zero sync bugs.

### How to Identify the SOR

Ask: **"Who is responsible for this data?"**

Examples:

- User profile data → User service owns it
- Shopping cart → Cart service owns it
- UI open/closed state → That specific UI component owns it
- Window positions → Window manager owns it

### Implementation Pattern

**SOR Component:**

```
class DataOwner {
  private data = []; // THE source of truth

  getData() { return this.data; }
  updateData(newData) { this.data = newData; this.notify(); }

  private notify() {
    // Tell everyone data changed
  }
}
```

**Consumer Component:**

```
class DataConsumer {
  constructor(private dataOwner: DataOwner) {} // Injected!

  render() {
    const data = this.dataOwner.getData(); // Always queries source
    // Never stores data locally
  }
}
```

### When Things Change

```
1. External event happens
2. SOR updates its internal state
3. SOR notifies all consumers
4. Consumers re-query SOR
5. Everyone has current truth
```

**No synchronization needed. No stale data possible.**

---

## Core Principle 2: Separation of Duties (SOD)

### The Concept

**Every unit of code does ONE thing.**

- One file = One responsibility
- One class = One job
- One function = One task

If you can't describe what it does in a single sentence, it's doing too much.

### The Test

**Can you answer this in one sentence?**

- "What does this file do?"
- "What is this class responsible for?"
- "What does this function do?"

**Examples:**

✅ Good answers:

- "Manages user authentication"
- "Renders the login form"
- "Calculates tax amounts"
- "Validates email addresses"

❌ Bad answers:

- "It handles user auth AND sends emails AND logs to database"
- "It renders the form AND validates input AND submits to API"
- "Various utility functions"

### File Size Rule of Thumb

If a file exceeds **~200 lines**, it's probably doing too much. Consider splitting.

### Examples

**❌ WRONG - File doing too much:**

```
LoginComponent
├─ Renders login form
├─ Validates inputs
├─ Calls authentication API
├─ Manages session tokens
├─ Redirects after login
├─ Handles error messages
└─ Logs analytics events
```

**✅ CORRECT - Separated duties:**

```
LoginForm          → Renders UI only
InputValidator     → Validates inputs only
AuthService        → Calls API only
SessionManager     → Manages tokens only
Router             → Handles navigation only
ErrorHandler       → Shows errors only
AnalyticsLogger    → Logs events only
```

### Benefits

1. **Easy to understand** - Each file has one clear purpose
2. **Easy to test** - Test one thing at a time
3. **Easy to change** - Changes stay localized
4. **Easy to reuse** - Small, focused units are more reusable
5. **Easy to debug** - Know exactly where to look

### How to Split

When a component gets too large:

1. **Identify distinct responsibilities**

   - What different things is this doing?

2. **Extract each to its own file**

   - Business logic → Controller/Service
   - Validation → Validator
   - Data fetching → Repository/Adapter
   - UI rendering → Component

3. **Wire them together**
   - Parent component composes them
   - Dependencies injected

---

## Core Principle 3: Dependency Injection (DI)

### The Concept

**Dependencies flow INWARD through constructors/props.**

Never import external systems directly. Define what you need via interfaces, receive implementations from outside.

### The Rule

```
If Component A needs Component B:
❌ A imports B directly
✅ A defines interface for what it needs
✅ B implements that interface
✅ A receives B via constructor/props
```

### Why This Matters

**Without DI (tight coupling):**

```
class UIComponent {
  constructor() {
    this.api = new APIService('https://api.example.com'); // HARD-CODED!
  }

  loadData() {
    return this.api.fetchData(); // Tightly coupled to APIService
  }
}
```

**Problems:**

- Can't test without hitting real API
- Can't swap API implementations
- Can't reuse component with different data source
- Component "knows too much"

**With DI (loose coupling):**

```
// Define what you need (interface)
interface DataSource {
  fetchData(): Data;
}

// Component depends on interface, not implementation
class UIComponent {
  constructor(private dataSource: DataSource) {} // Injected!

  loadData() {
    return this.dataSource.fetchData(); // Uses whatever was injected
  }
}

// Different implementations
class APIService implements DataSource { ... }
class MockService implements DataSource { ... }
class LocalStorageService implements DataSource { ... }

// Composition - wire it together
const api = new APIService();
const component = new UIComponent(api); // Inject dependency
```

**Benefits:**

- ✅ Easy to test (inject mock)
- ✅ Easy to swap implementations
- ✅ Component is reusable
- ✅ Clear boundaries

### Dependency Flow Direction

```
External World (data sources, APIs, services)
        ↓
    Adapters (translate external → internal)
        ↓
    Business Logic (use adapters via interfaces)
        ↓
    UI Components (display data)
```

**Key:** Dependencies always point INWARD. Core logic never imports from external world.

### Interface-First Design

1. **Define what you need** (interface)

   ```
   interface IDataStore {
     save(data): void;
     load(): data;
   }
   ```

2. **Use the interface** in your code

   ```
   class BusinessLogic {
     constructor(private store: IDataStore) {}
     // Use store.save(), store.load()
   }
   ```

3. **Implement the interface** externally

   ```
   class DatabaseStore implements IDataStore { ... }
   class FileStore implements IDataStore { ... }
   class MemoryStore implements IDataStore { ... }
   ```

4. **Wire it together** at the top level
   ```
   const store = new DatabaseStore();
   const logic = new BusinessLogic(store);
   ```

---

## File Structure: Domain-Driven Organization

### The Anti-Pattern (Type-Based Organization)

**❌ Organized by WHAT IT IS:**

```
project/
├── components/      ← All UI mixed together
├── services/        ← All business logic mixed together
├── models/          ← All data types mixed together
├── utils/           ← Random stuff
```

**Problems:**

- Related code is scattered
- Hard to find things
- Encourages "god files" (utils.js with everything)
- Domain concepts not clear

### The Pattern (Domain-Based Organization)

**✅ Organized by WHAT IT DOES:**

```
project/
├── feature-a/       ← Everything for Feature A
│   ├── core/        ← Business logic
│   ├── ui/          ← Presentation
│   ├── contracts/   ← Interfaces
│   └── adapters/    ← External connections
├── feature-b/       ← Everything for Feature B
│   ├── core/
│   ├── ui/
│   ├── contracts/
│   └── adapters/
└── shared/          ← Only truly shared utilities
```

**Benefits:**

- Related code lives together
- Easy to find things (all Feature A code in one place)
- Easy to understand feature boundaries
- Easy to delete features (delete one folder)
- Prevents cross-contamination

### Standard Layers Within Each Domain

**core/** - Business logic, no external dependencies

- Business rules
- State management
- Calculations
- Orchestration

**ui/** - Presentation layer (if applicable)

- Components
- Views
- Templates

**contracts/** - Interfaces and types, no implementations

- Define what you need from outside
- Data structures
- API contracts

**adapters/** - Connect to external world

- API clients
- Database access
- File system
- Third-party services

**Dependency flow:** ui → core → contracts ← adapters

---

## Development Process: Phased Domain Execution

### The Problem

When making changes:

- Easy to modify too many things at once
- Cross-domain contamination
- Hard to track what changed
- Subtle bugs from unexpected interactions

### The Solution

**Plan by domain, execute in phases, review between phases.**

---

### Step 1: Create a Plan Document

**Format:** `FEATURE_NAME_PLAN.md`

**Contents:**

- What you're building/changing
- Break down by domain
- One phase per domain
- List specific files to change per phase
- Define completion criteria

**Template:**

```markdown
# [Feature Name] Plan

## Overview

Brief description of what we're building/changing.

## Phase 1: [Domain Name]

**Files to modify:**

- path/to/file1.ext
- path/to/file2.ext

**Changes:**

- Specific change 1
- Specific change 2

**Completion Criteria:**

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] No other domains touched

---

## Phase 2: [Next Domain]

**Files to modify:**

- ...

**Changes:**

- ...

**Completion Criteria:**

- ...

---

[Continue for all domains...]

---

## Integration Phase

**Verification:**

- [ ] All phases complete
- [ ] End-to-end test passes
- [ ] Documentation updated
```

---

### Step 2: Execute Phase 1

**Rules:**

1. **Only modify files listed in Phase 1**
2. **Only make changes described in Phase 1**
3. **Do NOT:**
   - Touch other domains
   - Add "while I'm here" improvements
   - Fix unrelated issues
   - Refactor things not in the plan

**Example Phase 1 - Contracts Domain:**

```
Files: contracts/types/UserData.ts
Changes: Add optional 'avatar' property
```

**Execute:**

```typescript
// contracts/types/UserData.ts
interface UserData {
	id: string;
	name: string;
	email: string;
	avatar?: string; // ← ONLY THIS ADDED
}
```

---

### Step 3: Review Phase 1

**Before proceeding, verify:**

✅ **Only planned files modified**

- Check git diff
- Ensure no unexpected files changed

✅ **Only planned changes made**

- Review each change
- Nothing extra added

✅ **Code compiles/runs**

- No syntax errors
- No broken references

✅ **Completion criteria met**

- Check all criteria in plan

✅ **No other domains touched**

- No imports from other domains added
- No modifications to other domains

**Review Template:**

```
Phase 1 Review - [Domain Name]
─────────────────────────────────
Files modified:
✅ contracts/types/UserData.ts (planned)
❌ None others (good!)

Changes made:
✅ Added avatar property
✅ Added JSDoc comment

Code status:
✅ Compiles successfully
✅ No errors

Other domains touched:
❌ None (good!)

Completion criteria:
✅ Property added
✅ Type is optional
✅ Documented

Status: ✅ READY FOR PHASE 2
```

**If review FAILS:**

- Fix issues within same phase
- Review again
- **Don't proceed until phase is clean**

---

### Step 4: Execute Phase 2

Repeat the process for next domain:

1. Execute changes
2. Review
3. Verify
4. Proceed

---

### Step 5: Continue Through All Phases

For each remaining phase:

1. Execute (one domain only)
2. Review (verify isolation)
3. Verify (completion criteria)
4. Next phase

---

### Step 6: Integration Phase

After all domain phases complete:

**6.1 Integration Test**

- Run the entire system
- Test feature end-to-end
- Verify all domains work together
- Check for integration bugs

**6.2 Documentation Update**

- Update API docs
- Update architecture docs
- Update user docs

**6.3 Final Review**

```
Final Integration Review
─────────────────────────
✅ All phases completed
✅ Feature works end-to-end
✅ No cross-domain contamination
✅ Tests pass
✅ Documentation updated
✅ Code compiles
✅ No regressions

Status: ✅ COMPLETE
```

---

### Step 7: Handle Errors/Issues

**If issues found during integration:**

**7.1 Create Fix Plan**

New document: `FEATURE_NAME_FIX_PLAN.md`

Break down fix by domains again:

```markdown
# [Feature Name] Fix Plan

## Problem

Description of issue

## Phase 1: [Domain]

Fixes needed in this domain

## Phase 2: [Domain]

Fixes needed in this domain
```

**7.2 Iterate**

Execute fix plan using same phased approach:

- Phase 1 → Review → Phase 2 → Review → ...

**7.3 Repeat Until Clean**

Continue iteration until feature is complete and bug-free.

---

## Process Rules

### Golden Rules

1. **One domain per phase**

   - Never mix domains in a single phase
   - If you need to touch multiple domains, create multiple phases

2. **Review between phases**

   - Always verify phase completion before moving on
   - Never skip reviews

3. **Plan before coding**

   - No "cowboy coding"
   - Always have a written plan
   - Plan can be brief for small changes

4. **Document deviations**

   - If you deviate from plan, update the plan document
   - Note why in review

5. **Code must work after each phase**

   - Don't leave things broken between phases
   - Each phase should be a working state (might not be complete, but shouldn't be broken)

6. **No cross-domain leakage**
   - If Phase 2 forces changes to Phase 1 domain, STOP
   - Go back and fix Phase 1
   - Review Phase 1 again
   - Then continue Phase 2

### What Counts as "Touching a Domain"

**You touched a domain if:**

- Modified any file in that domain's folder
- Added imports from files in that domain
- Changed behavior that domain depends on

**You did NOT touch a domain if:**

- Read a file for reference (no edits)
- Used an interface/type from contracts (that's what they're for)

### When to Create a New Phase

**Create a new phase when:**

- Changing a different domain
- Making changes that can be independently verified
- Adding conceptually separate functionality

**Don't create phases for:**

- Every single file (too granular)
- Changes that must happen atomically together (too coarse)

**Good granularity:**

- Phase 1: Update data types (contracts domain)
- Phase 2: Update business logic (core domain)
- Phase 3: Update UI (ui domain)

**Too granular:**

- Phase 1: Update type1.ts
- Phase 2: Update type2.ts
- Phase 3: Update type3.ts
  (These should all be one phase - they're all types)

**Too coarse:**

- Phase 1: Update everything
  (Can't review, defeats purpose)

---

## Common Pitfalls & Solutions

### Pitfall 1: "While I'm Here" Syndrome

**Scenario:** While working on Phase 2, you notice unrelated code that could be improved.

**Temptation:** Fix it now.

**Problem:** Now Phase 2 has changes outside its scope. Review process breaks.

**Solution:**

- Note the issue in a TODO comment or separate doc
- Finish Phase 2 as planned
- Create separate plan for the improvement later

### Pitfall 2: Missing Dependency Discovered Mid-Phase

**Scenario:** While implementing Phase 3, you realize Phase 1 is missing something.

**Temptation:** Just add it quickly.

**Problem:** Can't complete Phase 3 without changing Phase 1. Phases are now entangled.

**Solution:**

- STOP Phase 3
- Go BACK to Phase 1
- Add the missing piece
- Review Phase 1 again
- Re-execute Phase 2 if it depends on the change
- NOW continue Phase 3

### Pitfall 3: Plan Was Incomplete/Wrong

**Scenario:** The plan said modify FileA, but you actually need to modify FileB.

**Temptation:** Just modify FileB and keep going.

**Problem:** Deviation from plan makes review meaningless.

**Solution:**

- Update the plan document
- Note the deviation in review
- Continue with corrected plan
- Learn for next time

### Pitfall 4: "Everything Depends on Everything"

**Scenario:** Changes seem to ripple across all domains simultaneously.

**Temptation:** Give up on phases, just change everything.

**Problem:** This means architecture is wrong. Too much coupling.

**Solution:**

- This is a red flag about your architecture
- Indicates violation of SOR/SOD/DI principles
- STOP feature work
- Fix architecture first
- Create plan to decouple domains
- Then retry feature with proper isolation

---

## Example Walkthrough (Generic)

### Scenario: Add "Theme Switching" Feature

**Step 1: Planning**

Create `THEME_SWITCHING_PLAN.md`:

```markdown
# Theme Switching Implementation Plan

## Overview

Allow users to switch between light/dark themes.

## Phase 1: Contracts Domain

**Files:**

- contracts/types/AppConfig.ts
- contracts/interfaces/IThemeProvider.ts

**Changes:**

- Add `theme: 'light' | 'dark'` to AppConfig type
- Create IThemeProvider interface with getTheme(), setTheme()

**Criteria:**

- [ ] Types compile
- [ ] Interface defines contract
- [ ] No implementation yet

---

## Phase 2: Core Domain

**Files:**

- core/services/ThemeService.ts (new file)

**Changes:**

- Implement IThemeProvider interface
- Store theme preference
- Notify on theme change

**Criteria:**

- [ ] Service implements interface
- [ ] Theme state managed
- [ ] No UI dependencies

---

## Phase 3: UI Domain

**Files:**

- ui/components/ThemeToggle.tsx (new file)
- ui/components/App.tsx (modify)

**Changes:**

- Create ThemeToggle button component
- Wire up to ThemeService
- Apply theme classes to App

**Criteria:**

- [ ] Button works
- [ ] Theme changes on click
- [ ] UI updates correctly

---

## Phase 4: Adapters Domain

**Files:**

- adapters/LocalStorageAdapter.ts (new file)

**Changes:**

- Persist theme to localStorage
- Load theme on startup

**Criteria:**

- [ ] Theme persists across sessions
- [ ] Loads correctly on startup

---

## Integration

**Verification:**

- [ ] All phases complete
- [ ] Theme switches work
- [ ] Theme persists
- [ ] No regressions
```

**Step 2: Execute Phase 1**

```typescript
// contracts/types/AppConfig.ts
export type Theme = 'light' | 'dark';

export interface AppConfig {
	theme: Theme;
	// ... other config
}

// contracts/interfaces/IThemeProvider.ts
export interface IThemeProvider {
	getTheme(): Theme;
	setTheme(theme: Theme): void;
	onThemeChange(callback: (theme: Theme) => void): UnsubscribeFn;
}
```

**Review Phase 1:**

- ✅ Only contracts files modified
- ✅ Types defined correctly
- ✅ Interface defines contract
- ✅ Code compiles
- ✅ No implementation (correct for contracts)
- ✅ No other domains touched

**Step 3: Execute Phase 2**

```typescript
// core/services/ThemeService.ts
export class ThemeService implements IThemeProvider {
	private theme: Theme = 'light';
	private callbacks: ((theme: Theme) => void)[] = [];

	getTheme(): Theme {
		return this.theme;
	}

	setTheme(theme: Theme): void {
		this.theme = theme;
		this.notify();
	}

	onThemeChange(callback: (theme: Theme) => void): UnsubscribeFn {
		this.callbacks.push(callback);
		return () => {
			const index = this.callbacks.indexOf(callback);
			if (index > -1) this.callbacks.splice(index, 1);
		};
	}

	private notify() {
		this.callbacks.forEach((cb) => cb(this.theme));
	}
}
```

**Review Phase 2:**

- ✅ Only ThemeService.ts created
- ✅ Implements IThemeProvider
- ✅ No UI imports
- ✅ Business logic isolated
- ✅ Code compiles
- ✅ No other domains touched

**Step 4: Execute Phase 3**

```tsx
// ui/components/ThemeToggle.tsx
export function ThemeToggle({ themeService }: { themeService: IThemeProvider }) {
	const [theme, setTheme] = useState(themeService.getTheme());

	useEffect(() => {
		return themeService.onThemeChange(setTheme);
	}, []);

	return (
		<button
			onClick={() => {
				const newTheme = theme === 'light' ? 'dark' : 'light';
				themeService.setTheme(newTheme);
			}}
		>
			Toggle Theme ({theme})
		</button>
	);
}

// ui/components/App.tsx
export function App() {
	const themeService = new ThemeService(); // Or get from DI container
	const [theme, setTheme] = useState(themeService.getTheme());

	useEffect(() => {
		return themeService.onThemeChange(setTheme);
	}, []);

	return (
		<div className={`app theme-${theme}`}>
			<ThemeToggle themeService={themeService} />
			{/* rest of app */}
		</div>
	);
}
```

**Review Phase 3:**

- ✅ Only UI files modified
- ✅ Components use injected service (DI)
- ✅ Theme updates on click
- ✅ Code compiles
- ✅ No other domains touched

**Step 5: Execute Phase 4**

```typescript
// adapters/LocalStorageAdapter.ts
export class LocalStorageThemeAdapter {
	private static STORAGE_KEY = 'app-theme';

	constructor(private themeService: IThemeProvider) {
		this.loadTheme();
		this.subscribeToChanges();
	}

	private loadTheme() {
		const saved = localStorage.getItem(LocalStorageThemeAdapter.STORAGE_KEY);
		if (saved === 'light' || saved === 'dark') {
			this.themeService.setTheme(saved);
		}
	}

	private subscribeToChanges() {
		this.themeService.onThemeChange((theme) => {
			localStorage.setItem(LocalStorageThemeAdapter.STORAGE_KEY, theme);
		});
	}
}

// Wire it up in main.ts
const themeService = new ThemeService();
new LocalStorageThemeAdapter(themeService); // Connect persistence
```

**Review Phase 4:**

- ✅ Only adapter files modified
- ✅ Persistence implemented
- ✅ Uses DI (receives service)
- ✅ Code compiles
- ✅ No other domains touched

**Step 6: Integration Test**

- ✅ Click toggle → theme changes
- ✅ Refresh page → theme persists
- ✅ All domains work together
- ✅ No errors

**Step 7: Documentation**

- Update API docs
- Add example usage

**Done!** ✅

---

## Process Checklist

### For Every New Feature/Change:

**Planning:**

- [ ] Create plan document (`FEATURE_NAME_PLAN.md`)
- [ ] Identify all domains that need changes
- [ ] Break into phases (one domain per phase)
- [ ] List specific files per phase
- [ ] Define completion criteria per phase
- [ ] Note phase dependencies

**Execution (repeat for each phase):**

- [ ] Execute changes for current phase ONLY
- [ ] Verify only planned files modified
- [ ] Code compiles/runs
- [ ] No other domains touched
- [ ] Completion criteria met
- [ ] Document any deviations

**Integration:**

- [ ] All phases completed
- [ ] End-to-end test passes
- [ ] Documentation updated
- [ ] Final review complete

**If Errors:**

- [ ] Create fix plan
- [ ] Break fixes into domain phases
- [ ] Iterate using same process

---

## Quick Reference

### Architecture in 3 Sentences

1. **SOR:** Every piece of data has exactly one owner; everyone else queries it.
2. **SOD:** Every file/class/function does exactly one thing; if it does more, split it.
3. **DI:** Dependencies are injected via constructor/props; never imported directly.

### Process in 3 Steps

1. **Plan:** Break work into domain phases, one phase per domain
2. **Execute:** Do one phase, review, repeat
3. **Integrate:** Test all domains together, iterate if needed

### File Organization in 3 Layers

1. **core:** Business logic, no external dependencies
2. **contracts:** Interfaces, define what you need
3. **adapters:** Connect to external world

### Review Checklist (Per Phase)

- [ ] Only planned files modified?
- [ ] Only planned changes made?
- [ ] Code works?
- [ ] No other domains touched?

---

## Summary

This methodology prevents the chaos that kills large projects:

- **SOR** prevents state synchronization bugs
- **SOD** keeps code understandable and maintainable
- **DI** keeps code flexible and testable
- **Phased execution** prevents cross-domain contamination

**Result:** Clean, maintainable, scalable systems that stay manageable as they grow.

When you follow these principles, adding features is straightforward, debugging is easy, and the codebase stays healthy indefinitely.
