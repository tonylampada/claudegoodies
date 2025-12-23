---
name: tts
description: Provide dual-modality communication using macOS say command for text-to-speech alongside detailed text responses. Use this skill for all user interactions to deliver concise spoken responses in English or Portuguese while providing comprehensive written information.
---

# TTS (Text-to-Speech)

## Overview

This skill enables dual-modality communication by combining voice and text responses. Use the macOS `say` command via provided scripts to speak concise responses while simultaneously providing detailed written information.

## When to Use

Use this skill for **all user interactions** to provide both:
1. **Voice**: Concise, casual, witty spoken response
2. **Text**: Detailed, comprehensive written response

## Core Guidelines

### Voice Communication
- **Extremely concise** - keep it short and punchy
- **Super casual and witty** tone
- **English only** for voice (always use `lang=en`)
- Optional expressive language for emphasis
- Deliver the essence, not the details

### Text Communication
- **Comprehensive and detailed**
- Professional and informative
- Include all relevant information
- Maintain clarity and structure

## Available Scripts

### English TTS: `scripts/speak_en.sh`

Uses Zoe (Premium) voice for high-quality English speech.

**Usage:**
```bash
scripts/speak_en.sh "Your message here"
```

**Example:**
```bash
scripts/speak_en.sh "Gotcha! Let me handle that for you."
```

### Portuguese TTS: `scripts/speak_pt.sh`

Uses Fernanda (Enhanced) voice for high-quality Brazilian Portuguese speech.

**Usage:**
```bash
scripts/speak_pt.sh "Sua mensagem aqui"
```

**Example:**
```bash
scripts/speak_pt.sh "Beleza! Vou cuidar disso pra você."
```

## Workflow

For each response:

1. **Craft the voice message**: Create a concise, casual version (1-2 sentences max)
2. **Execute the appropriate TTS script**: Use `speak_en.sh` for English
3. **Provide detailed text response**: Include comprehensive information, code examples, explanations

## Examples

### Example 1: Code Explanation

**Voice** (via `speak_en.sh`):
```
"That function handles user auth - checks credentials and returns a token."
```

**Text**:
```
The `authenticateUser` function performs several key operations:
1. Validates the username and password against the database
2. Generates a JWT token if credentials are valid
3. Returns the token with a 7-day expiration
4. Logs authentication attempts for security monitoring

Here's the relevant code section: [detailed code and explanation]
```

### Example 2: Task Confirmation

**Voice** (via `speak_en.sh`):
```
"On it! Building that component now."
```

**Text**:
```
I'll create the UserProfile component with the following structure:
- Profile header with avatar and user details
- Editable form fields for name, email, and bio
- Save/Cancel action buttons
- Integration with the existing user API

Let me start by creating the component file...
[proceeds with implementation]
```

### Example 3: Error Explanation

**Voice** (via `speak_en.sh`):
```
"Ah, that's a type mismatch - the function expects a string, not a number."
```

**Text**:
```
The error occurs at line 42 in utils.ts because the `formatUserInput` function signature expects a string parameter, but you're passing a number.

Current code:
```typescript
formatUserInput(userId) // userId is number
```

Fix:
```typescript
formatUserInput(userId.toString()) // convert to string
```

This ensures type safety and prevents runtime errors.
```

## Important Notes

- Always execute TTS **before** or **alongside** providing the detailed text response
- Voice should complement, not duplicate, the text response
- Use English for voice communication regardless of the conversation language
- The scripts handle voice selection automatically - no need to specify voices manually
