#!/usr/bin/env python3
"""
Claude Code Pre-Commit Hook — Agentic Concierge
Runs type checking and linting before allowing commits.
Compatible with Windows (PowerShell) and Unix systems.
"""

import subprocess
import sys
import os

def run_command(cmd, description):
    """Run a command and return success/failure."""
    print(f"\n{'='*50}")
    print(f"  Running: {description}")
    print(f"{'='*50}")
    
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            cwd=os.environ.get('PROJECT_ROOT', '.')
        )
        
        if result.stdout:
            print(result.stdout)
        
        if result.returncode != 0:
            print(f"\n❌ FAILED: {description}")
            if result.stderr:
                print(result.stderr)
            return False
        
        print(f"✅ PASSED: {description}")
        return True
    
    except FileNotFoundError:
        print(f"\n❌ MISSING TOOL: {description}")
        print(f"   Command not found. Run 'npm install' to ensure dev dependencies are installed.")
        return False  # Block commits — a missing tool means checks are not running


def main():
    """Run all pre-commit checks."""
    print("\n🔍 Agentic Concierge — Pre-Commit Checks\n")
    
    checks = [
        ("npx tsc --noEmit", "TypeScript type checking"),
        ("npx eslint src/ --ext .ts,.tsx --max-warnings 0", "ESLint"),
    ]
    
    failed = []
    
    for cmd, desc in checks:
        if not run_command(cmd, desc):
            failed.append(desc)
    
    print(f"\n{'='*50}")
    if failed:
        print(f"❌ {len(failed)} check(s) failed:")
        for f in failed:
            print(f"   - {f}")
        print(f"\nFix these issues before committing.")
        print(f"{'='*50}\n")
        sys.exit(1)
    else:
        print(f"✅ All checks passed!")
        print(f"{'='*50}\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
