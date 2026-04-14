#!/usr/bin/env python3
"""Wrapper qui lit les args depuis agent_args_temp.txt puis appelle agent_analyze.py"""
import sys, os

args_file = os.path.join(os.path.dirname(__file__), "agent_args_temp.txt")
with open(args_file, encoding='utf-8') as f:
    lines = [l.strip() for l in f.readlines() if l.strip()]

sys.argv = [sys.argv[0]] + lines

# Importer et lancer agent_analyze
import importlib.util
spec = importlib.util.spec_from_file_location("agent_analyze", os.path.join(os.path.dirname(__file__), "agent_analyze.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.main()
