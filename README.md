# Tony Lampada's Claude Goodies

A collection of Claude skills and plugins designed to enhance productivity and interaction.

How to install - [video](https://www.loom.com/share/557242c82101437db9fd5d50b7ddfd12)

## Included Skills

### 🔍 [PR Review](./skills/pr-review)
Conduct expert-level pull request reviews using the `gh` CLI and a local working directory. It focuses on code quality, bug prevention, and architectural improvements following three-layer architecture principles.

### 🎙️ [TTS (Text-to-Speech)](./skills/tts)
Enables dual-modality communication by combining voice and text responses. It uses the macOS `say` command to deliver concise, witty spoken responses while providing detailed written information.

demo - [video]([https://www.loom.com/share/e4a9f544efd04fedb208311b66104fda](https://www.loom.com/share/c42ce851904f45f3b2d40ee7f84dd4d1))

* hook configuration - [settings.json](https://gist.github.com/tonylampada/9d3c52d108f9939c001047e425395f6b)
* hook script - [notification.sh](https://gist.github.com/tonylampada/df613200d70272ae87b3276a008548ff)

### 🧭 [Bridge](./skills/bridge)
A live "agent OS board": a local web UI where a human watches an AI agent's work state as a kanban board and talks to the agent in context. Zero-dependency node server + `bridge-axi` CLI; any agent with shell access can drive it.

## Included Tools

### 📬 [AgentMail listener](./tools/agentmail-listen.md)
Generic AgentMail websocket listener that runs a configured command for each matching email event.

### 📝 [Avoma meeting ID from email](./tools/avoma-meeting-id-from-email.md)
Extract Avoma meeting UUIDs from Avoma notification/forwarded emails so `avoma-cli` can fetch transcripts.

### 📬 [AgentMail Avoma meeting IDs](./tools/agentmail-avoma-meeting-ids.md)
Scan recent AgentMail messages and extract Avoma meeting UUIDs.
