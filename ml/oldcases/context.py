"""Build BERT inputs for sentence roles within one judgment."""


def contextual_roles(tokenizer, sentences, length):
    if length < 4:
        raise ValueError("Role context requires four BERT framing tokens")
    if not sentences:
        return []
    tokens = tokenizer(sentences, add_special_tokens=False, verbose=False)["input_ids"]
    budget = length - 4
    window = []
    for i, target in enumerate(tokens):
        previous = tokens[i - 1] if i else []
        following = tokens[i + 1] if i + 1 < len(tokens) else []
        side_limit = max(budget // 4, (budget - len(target)) // 2)
        left = previous[max(0, len(previous) - side_limit):]
        right = following[:side_limit]
        center = target[:budget - len(left) - len(right)]
        cls, sep = tokenizer.cls_token_id, tokenizer.sep_token_id
        window.append([cls, *left, sep, *center, sep, *right, sep])
    return window
