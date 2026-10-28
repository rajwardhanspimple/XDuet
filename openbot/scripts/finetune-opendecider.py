"""
OpenDecider / Laya Fine-Tuning Script
====================================
Fine-tunes a lightweight base SLM (such as Qwen2.5-0.5B-Instruct or Llama-3.2-1B-Instruct)
on the exported OpenDuet decision dataset (`data/opendecider-sft.jsonl`) using LoRA/QLoRA.

Requirements:
    pip install torch transformers peft datasets trl accelerate bitsandbytes

Usage:
    python scripts/finetune-opendecider.py --model Qwen/Qwen2.5-0.5B-Instruct --epochs 3
"""

import argparse
import os
import json
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Fine-tune OpenDecider / Laya SLM")
    parser.add_argument("--model", type=str, default="Qwen/Qwen2.5-0.5B-Instruct", help="Base model identifier")
    parser.add_argument("--data", type=str, default="data/opendecider-sft.jsonl", help="Input SFT JSONL dataset")
    parser.add_argument("--output", type=str, default="models/opendecider-finetuned", help="Output directory for weights")
    parser.add_argument("--epochs", type=int, default=3, help="Number of training epochs")
    parser.add_argument("--batch_size", type=int, default=4, help="Per-device batch size")
    parser.add_argument("--lr", type=float, default=2e-4, help="Learning rate")
    parser.add_argument("--max_seq_length", type=int, default=32768, help="Max context sequence length in tokens (default: 32k, supports up to 128k)")
    args = parser.parse_args()

    print(f"==================================================")
    print(f"OpenDecider / Laya Fine-Tuning Recipe")
    print(f"==================================================")
    print(f"Base model:       {args.model}")
    print(f"Dataset:          {args.data}")
    print(f"Target directory: {args.output}")
    print(f"Max Context Tokens:{args.max_seq_length} (Long-Context)")
    print(f"Epochs:           {args.epochs}")
    print(f"==================================================")

    data_file = Path(args.data)
    if not data_file.exists():
        print(f"Error: Dataset {args.data} not found. Run `bun run train:deciders` or `bun run export:decision-dataset` first.")
        return

    # Count rows
    with open(data_file, "r", encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    print(f"Loaded {len(rows)} training examples.")

    try:
        import torch
        from datasets import Dataset
        from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
        from peft import LoraConfig, get_peft_model
        from trl import SFTTrainer
    except ImportError:
        print("\nNote: GPU fine-tuning libraries (torch, transformers, peft, trl) are not installed in the local environment.")
        print("To run deep neural network fine-tuning on a GPU machine or Colab:")
        print("    pip install torch transformers peft datasets trl accelerate bitsandbytes")
        print("    python scripts/finetune-opendecider.py")
        print("\nThe embedded statistical log-odds classifier (models/opendecider-nano/weights.json) is already trained and operational locally.")
        return

    print("Initializing tokenizer and base model...")
    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=torch.bfloat16 if torch.cuda.is_available() and torch.cuda.is_bf16_supported() else torch.float32,
        device_map="auto" if torch.cuda.is_available() else "cpu",
        trust_remote_code=True,
    )

    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)

    dataset = Dataset.from_list(rows)

    def format_chat(sample):
        return {"text": tokenizer.apply_chat_template(sample["messages"], tokenize=False)}

    formatted_dataset = dataset.map(format_chat)

    training_args = TrainingArguments(
        output_dir=args.output,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        learning_rate=args.lr,
        logging_steps=10,
        save_strategy="epoch",
        fp16=torch.cuda.is_available(),
    )

    trainer = SFTTrainer(
        model=model,
        train_dataset=formatted_dataset,
        dataset_text_field="text",
        max_seq_length=args.max_seq_length,
        tokenizer=tokenizer,
        args=training_args,
    )

    print("Starting training...")
    trainer.train()

    print(f"Saving fine-tuned adapter to {args.output}...")
    trainer.model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    print("Fine-tuning completed successfully!")

if __name__ == "__main__":
    main()

