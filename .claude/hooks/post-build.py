#!/usr/bin/env python3
"""
Claude Code Post-Build Hook — Agentic Concierge
Runs tests after successful builds and optionally notifies via TTS (Windows).
Mirrors the hook pattern from the Magellan project.
"""

import subprocess
import sys
import os
import platform


def notify(message, success=True):
    """Send a notification. Uses PowerShell TTS on Windows, echo elsewhere."""
    if platform.system() == "Windows":
        voice = "Add-Type -AssemblyName System.Speech;"
        voice += "$speak = New-Object System.Speech.Synthesis.SpeechSynthesizer;"
        voice += f'$speak.Speak("{message}");'
        subprocess.run(["powershell", "-Command", voice], capture_output=True)
    else:
        icon = "✅" if success else "❌"
        print(f"\n{icon} {message}")


def run_tests():
    """Run the test suite."""
    print("\n🧪 Running post-build tests...\n")
    
    result = subprocess.run(
        "npm test -- --passWithNoTests",
        shell=True,
        capture_output=True,
        text=True,
        cwd=os.environ.get('PROJECT_ROOT', '.')
    )
    
    if result.stdout:
        print(result.stdout)
    
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr)
        
        # Extract failure summary for notification
        lines = (result.stdout + result.stderr).split('\n')
        fail_lines = [l for l in lines if 'fail' in l.lower() or 'error' in l.lower()]
        summary = fail_lines[0] if fail_lines else "Tests failed"
        
        notify(f"Build tests failed: {summary}", success=False)
        return False
    
    notify("All build tests passed", success=True)
    return True


def check_prompt_versions():
    """Verify all agent prompts have version constants."""
    print("\n📋 Checking agent prompt versions...\n")
    
    prompts_dir = os.path.join(
        os.environ.get('PROJECT_ROOT', '.'),
        'src', 'agents'
    )
    
    if not os.path.exists(prompts_dir):
        print("   ⚠️  src/agents/ not found yet — skipping prompt check")
        return True
    
    missing = []
    for root, dirs, files in os.walk(prompts_dir):
        for f in files:
            if f == 'system.ts':
                filepath = os.path.join(root, f)
                with open(filepath, 'r', encoding='utf-8') as fh:
                    content = fh.read()
                    if 'PROMPT_VERSION' not in content:
                        missing.append(filepath)
    
    if missing:
        print("   ❌ Missing PROMPT_VERSION in:")
        for m in missing:
            print(f"      - {m}")
        return False
    
    print("   ✅ All prompts versioned")
    return True


def main():
    print("\n🏗️  Agentic Concierge — Post-Build Checks\n")
    
    all_passed = True
    
    if not check_prompt_versions():
        all_passed = False
    
    if not run_tests():
        all_passed = False
    
    if all_passed:
        print("\n✅ Post-build: All checks passed\n")
    else:
        print("\n❌ Post-build: Some checks failed\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
