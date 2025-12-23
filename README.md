# Tony Lampada's Claude Goodies

A collection of Claude skills and plugins designed to enhance productivity and interaction.

Here's how to install:

[![Watch the video](https://cdn.loom.com/sessions/thumbnails/557242c82101437db9fd5d50b7ddfd12-eaa406b43bfdd226.gif)](https://www.loom.com/share/557242c82101437db9fd5d50b7ddfd12)

## Included Skills

### 🔍 [PR Review](./skills/pr-review)
Conduct expert-level pull request reviews using the `gh` CLI and a local working directory. It focuses on code quality, bug prevention, and architectural improvements following three-layer architecture principles.

### 🎙️ [TTS (Text-to-Speech)](./skills/tts)
Enables dual-modality communication by combining voice and text responses. It uses the macOS `say` command to deliver concise, witty spoken responses while providing detailed written information.

## Project Structure

- `skills/`: Contains the source code and documentation for each individual skill.
  - `pr-review/`: Pull Request review automation logic and guidelines.
  - `tts/`: Text-to-speech scripts and workflow.
- `.claude-plugin/`: Configuration for the Claude plugin marketplace.

## Metadata

See [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json) for plugin definitions and source mapping.

