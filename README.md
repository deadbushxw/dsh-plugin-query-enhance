# dsh-plugin-query-enhance

[English](README.md) | [中文](README.zh.md)

A Host-side [DeepSeek Harness](https://github.com/deepseek-ai) plugin that makes
asking about the current profile's bundles cheap.

It does two things, and they are complementary rather than alternatives:

- **It shrinks what the list actions return.** Both `plugin_manager list_bundles`
  and `plugin_manager list_plugins` are management surfaces, so both answer with
  more than the caller asked for. `list_bundles` returns every bundle *and* the
  complete list of plugin rows it declares - a real profile spends most of that
  payload on two bundles, **86** declared rows for `@deepseek-ai/dsh-base` and **85**
  for `@deepseek-ai/dsh-web-app`. `list_plugins` returns a page of plugin entries
  nobody chose. Both now come back as one summary line per record. The projection
  runs inside the Host, before the payload is serialized, so those bytes are never
  produced rather than produced and then ignored.
- **It adds `plugin_query`**, a read-only tool that takes filters and returns only
  the records that survived them — down to the level of "which bundle declares
  this module".

Neither mechanism modifies `@deepseek-ai/dsh-plugin-manager`. The core stays exactly
as it shipped, the Web Client keeps reading the service directly, and removing
this bundle restores the previous behaviour completely.

**Requirements**

| | |
|---|---|
| OS | any (the plugin is pure JavaScript and touches no platform API) |
| DSH | a profile whose management plugin exposes the `pluginManager` service |
| Node.js | 20+ — for the tests and the boundary checker, not to run the plugin |

The package name, the repository directory, the Loader row, and the display name
all use the same identifier — **`dsh-plugin-query-enhance`** — so there is exactly one
name to search for. Only `package.json` is read by the Loader; the directory name is
irrelevant.

---

## The problem, measured

`plugin_manager` has two list actions. Both take `offset` and `limit` and nothing
else — no name, no state filter, no field selection. The default page size is 25,
and a profile has about a dozen bundles, so **the first call always returns the
whole table**. Paging cannot help, because there is nothing to page past.

What comes back per bundle is the management record: identity, four state
booleans, the package description, the full `rows` array of declared plugin
entries, the built-in rows the bundle overrides, and any error with its
diagnostics. The `rows` array dominates. Measured on this machine, the declared
rows of the two bundles above serialized to about **11 KB for 144 rows** — roughly
76 bytes per row before counting the live entry ids, which add more.

Two consequences follow, and this plugin answers both:

| Consequence | Mechanism |
|---|---|
| A model that does not know a better tool exists calls `list_bundles` and pays for the whole table | **The projection**: `list_bundles` still answers, but with one summary line per bundle |
| A model that *does* know what it wants has no way to say so | **`plugin_query`**: filters in the schema, filtering on the host, only matches returned |

---

## Install

Installation is a bundle install: DSH writes the package into the active profile,
registers the Loader row, and hot-applies it. Do not hand-edit the profile.

### 1. Get the code onto the machine

```sh
git clone https://github.com/deadbushxw/dsh-plugin-query-enhance "%USERPROFILE%\.dsh\dsh-plugins\dsh-plugin-query-enhance"
```

Any directory works; the path above is only an example. There is no build step.

### 2. Install it into a profile

Ask the Agent in the profile you want it in, naming either the cloned directory
or the repository:

> Install the bundle at `%USERPROFILE%\.dsh\dsh-plugins\dsh-plugin-query-enhance` with
> `plugin_manager install_bundle`.

Or install straight from GitHub, with no clone:

> Install the bundle `github:deadbushxw/dsh-plugin-query-enhance` with
> `plugin_manager install_bundle`.

Or, in the GUI: **Settings → Plugins**, add the package directory as a local
bundle and enable it.

`plugin_manager` reports `application: "applied"` when the change is live. If it reports
`restart-required`, restart DSH. Replacing an already-installed package with new
code also requires a restart, because the Host caches module instances.

### 3. Confirm it works

Ask for the bundles and look at the shape of the answer:

```
plugin_manager list_bundles
```

Every entry now carries `name`, `version`, `enabled`, `installed`, `optional`,
`removable` and `rowCount` — and no `rows` array, no `description`, no `meta`. Then ask a
question only the new tool can answer:

```
plugin_query match="cordis-plugin-hmr"
```

Both halves are working when the first answer is one line per bundle and the
second names the bundle that declares that module.

### Uninstall

```
plugin_manager remove_bundle dsh-plugin-query-enhance
```

Nothing is left behind. `list_bundles` goes back to returning the full table.

---

## Usage

### What the list actions return now

Neither action changed, including `offset`, `limit`, `total` and `nextOffset`. Only
each record is smaller. A bundle comes back as: 

```json
{"entries":[{"name":"@deepseek-ai/dsh-web-app","version":"0.1.2-alpha.1","enabled":true,
"installed":false,"optional":false,"removable":false,"rowCount":85}],
"total":11,"nextOffset":null}
```

Dropped, and why:

| Field | Why it is safe to drop |
|---|---|
| `rows` | The bulk. Recoverable on demand with `plugin_query includeRows=true`, which returns the rows of the one bundle you name |
| `description` | The package's own prose, written for a human browsing a package manager |
| `meta` | Localized display text and icon paths, read by the Web Client, which does not go through this path anyway |
| `overrides` | The built-in row ids the bundle replaces; summarised as `overrideCount` |
| `error.diagnostic`, `error.incompatible` | Long-form failure text. The error **code** survives, because that is what decides the next step |

Two fields exist only to say what was omitted: `rowCount` is always present, so a
reader can tell "this bundle declares no plugins" from "this answer hides them",
and `overrideCount` appears only when the bundle overrides something.

A plugin entry comes back as:

```json
{"entries":[{"entryId":"timer","moduleName":"@deepseek-ai/cordis-plugin-timer",
"enabled":true,"fiberPhase":"active"}],"total":187,"nextOffset":25}
```

`patchId` is the one field that summary drops: it is the profile patch row that
addresses the entry, which no documented operation takes as an argument.
`entryId` stays, because it is what `set_plugin` takes, and `readOnlyReason` stays,
because it explains a refused action.

Need the ids to call `set_plugin`? `plugin_query name="..." includeRows=true` returns
the rows a bundle declares, and a `list_plugins` summary keeps every `entryId`.
Anything more - the full bundle record, a plugin entry's `patchId`, error
diagnostics - comes from `plugin_query` with `detail: "full"`, which is the only path
that returns a complete record.

### `plugin_query`

Read-only, takes no arguments that change anything, and needs no approval.

| Parameter | Applies to | Meaning |
|---|---|---|
| `kind` | both | `"bundles"` (default) or `"plugins"`, for individual plugin entries |
| `name` | bundles | Exact bundle package name, for example `@deepseek-ai/dsh-base` |
| `match` | both | Case-insensitive substring over the name, the description, and the module names of the rows a bundle declares |
| `enabled` | both | Keep only records whose saved enabled state equals this |
| `installed` | bundles | Keep only bundles whose installed state equals this |
| `optional` | bundles | Keep only bundles shipped switched off for the user to turn on |
| `hasError` | bundles | `true` keeps only bundles that failed to load; `false` keeps only the ones that loaded |
| `detail` | both | `"summary"` (default) or `"full"`, the management record including description and rows |
| `includeRows` | bundles | In a summary, also include the declared plugin rows |
| `limit` | both | Page size, 1 to 100. Defaults to **10** |
| `offset` | both | Zero-based offset into the **filtered** result. Defaults to 0 |

Filters combine with **AND**. Supplying a bundle-only filter with
`kind: "plugins"` is an error rather than a silently ignored condition, and so is an
empty `name` or `match` — an empty filter would quietly match everything, which is
the outcome this package exists to prevent.

Every answer carries `total` (the inventory size), `matched` (how many survived the
filters), and `nextOffset`. The pair `total`/`matched` is what makes a zero result
unambiguous: `matched: 0` with `total: 11` means the bundle exists and was filtered
out, and there is no need to repeat the call without filters to find out.

Examples:

```
plugin_query name="@deepseek-ai/dsh-base"
plugin_query match="cordis-plugin-hmr"          # which bundle declares this module?
plugin_query enabled=false                        # what is switched off?
plugin_query hasError=true detail="full"          # why did something fail to load?
plugin_query optional=true                        # what was shipped switched off?
plugin_query kind="plugins" enabled=false limit=50
```

---

## Configuration

There is no configuration file and no settings page. Both settings live in the
bundle's own `cordis.patch.yml`, which is validated against the `Config` schema the
package exports. Edit it there and reinstall the bundle.

```yaml
- insert:
    - id: dsh-plugin-query-enhance
      name: 'dsh-plugin-query-enhance'
      config:
        intercept: true
        defaultDetail: summary
```

| Field | Default | Meaning |
|---|---|---|
| `intercept` | `true` | Project `plugin_manager list_bundles` results. Set to `false` to keep the tool but stop rewriting that action's output |
| `defaultDetail` | `"summary"` | The detail level `plugin_query` applies when a call omits `detail` |

---

## How it works

Two extension points, no fork:

| Mechanism | Extension point | Why this one |
|---|---|---|
| The projection | `tools/post-execute` | The tool runtime documents it as the place to transform a result, and it is the only plugin-reachable point that can change what a model receives from another tool. It targets both list actions, because which one a caller reaches for is not predictable |
| The query tool | `ctx.tools.register()` plus the `pluginManager` service | Adding a tool cannot collide with anything, and the service is what the management tool itself reads |

Three decisions worth stating, because each is a deliberate trade:

- **The projection calls `next()` before it decides anything**, even for the calls it
  rewrites. A waterfall listener that returns a decision without delegating ends
  the chain for every listener behind it — for instance a tool-hook plugin that
  would have logged or blocked the call. Refining whatever the rest of the chain
  settled on, and deferring when it already replaced the result, keeps other
  plugins' decisions intact.
- **A payload it cannot parse is passed through untouched.** A projection that
  cannot run must cost the caller nothing, never break a working management call.
  The same guard covers a future Host that changes the envelope.
- **The tool is defined with the raw JSON Schema the registry enforces**, not
  through the first-party `defineTool` helper. That helper lives in
  `@deepseek-ai/dsh-tools`; importing it would pin this package to a Host package
  at a version, so a clone would need a registry round trip before it could load
  and a Host upgrade could desynchronize the two copies. The registry's documented
  contract is `ctx.tools.register()`, and it takes the compiled form. The cost is
  that argument validation, which the helper would install, is written here and
  tested instead.

---

## Repository boundary

**This repository is safe to publish as-is, and this section is the contract that
makes that checkable rather than a claim.**

### What is committed

Source, tests, tooling, documentation, and metadata:

```
.gitattributes  .gitignore  LICENSE
README.md  README.zh.md
package.json  cordis.patch.yml
icon.svg  locale/{en,zh}.json
lib/**                 the plugin itself
test/**                the test suite, runnable with no install
tools/verify-repo-boundary.mjs   the check described below
```

### What is deliberately not committed

| Kept out | Why |
|---|---|
| `DESIGN.md` | Internal working notes. They quote the absolute directories of the machine they were written on, so publishing them would leak that machine's layout |
| `node_modules/` | Reproducible from `package.json`; noise in a diff |
| `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` | Installation is owned by DSH's `install_bundle` (pnpm). A second lockfile would describe a different resolver and drift |
| `*.bak`, `*.orig`, `*.rej`, `*.log` | Local scratch left by editing and installing |
| `config.json`, `plugin-data/`, `.env*`, `*.pem`, `*.key`, `.credentials.yaml` | Runtime state and credentials. This plugin has neither, and the patterns are a second line of defence |
| editor and OS noise (`.vscode/`, `.DS_Store`, `Thumbs.db`, …) | Not part of the project |

There are no secrets of any kind in this project: it stores no account, no token,
and no API key, and it makes no network requests.

### How to verify the boundary yourself

```sh
npm run verify-boundary
```

`verify-boundary` reads the set of files **git would publish** (`git ls-files`), not
the working tree — untracked local files are precisely what the boundary is meant
to keep out. It reports machine-specific absolute paths, credential-shaped text,
runtime state, and unexpectedly large files, and it exits non-zero on anything it
finds. Run it before every push.

---

## Development

```sh
npm test        # the whole suite; no install needed
npm run verify-boundary
```

The suite has no dependencies and no side effects: it never touches the
filesystem, the network, or a Host. That is not an accident — `lib/config.js` is
import-free on purpose, and the one runtime dependency lives alone in
`lib/schema.js`, so nothing the tests import has to be resolved.
`npm install` is only needed if you want to load `lib/index.js` itself.

Structure, and why it is split this way:

| File | Responsibility |
|---|---|
| `lib/index.js` | Entry point. Wires the waterfall listener and the tool, owns teardown |
| `lib/config.js` | Constants and effective settings. Imports nothing |
| `lib/schema.js` | The `Config` schema. The only file with a dependency |
| `lib/shape.js` | Display-metadata stripping, shared by both mechanisms |
| `lib/project.js` | Mechanism 1: summarize a whole list payload, either action |
| `lib/intercept.js` | Mechanism 1: the `tools/post-execute` listener |
| `lib/filter.js` | Mechanism 2: the query engine |
| `lib/tool.js` | Mechanism 2: the tool definition and its argument contract |

---

## Known limitations

- **The management tool's own schema cannot be extended.** A plugin cannot add
  parameters to a tool another plugin registered, so the list actions can only be
  *shrunk* by default, never filtered. That is what `plugin_query` is for; the
  projection is the safety net for a caller that reaches for the old tool anyway.
- **`list_plugins` is already partly summarised by the management tool**, which
  drops display metadata before returning. The projection there removes `patchId`
  and keeps the same envelope, so the reduction is real but modest; the large win
  remains `list_bundles`.
- **`detail: "full"` on a bundle with many declared rows is still large.** It is the
  management record by design. A `match` narrows the rows to the ones it hit, which
  is usually what makes it affordable.
- **`plugin_query` disappears if the `pluginManager` service is absent.** The
  projection half stays active; the tool is simply not registered. Look for the
  plugin's own debug line to tell the two apart.
- **The tool adds a small fixed cost to every request.** Its schema and
  description are sent whether or not it is used. The description is kept short
  for that reason, and the projection half adds nothing at all.
- **No settings page.** Both settings are row configuration, edited in
  `cordis.patch.yml`. Adding a page would mean marking fields volatile and
  shipping a Client half, which is more moving parts than two booleans justify.
- **The projection is a policy, not a filter.** It decides what `list_bundles`
  returns in the absence of a better question. `intercept: false` restores the
  original behaviour exactly.

## License

[MIT](LICENSE) © 2026 deadbushxw.
