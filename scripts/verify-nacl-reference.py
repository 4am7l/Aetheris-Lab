"""Reproduce the independent IPhreeqc/Pitzer results used by Vitest."""

import argparse
import ctypes
import hashlib
import json
import math
from pathlib import Path

from phreeqpy.iphreeqc.phreeqc_dll import IPhreeqc

FIXTURE = Path(__file__).resolve().parents[1] / "tests/fixtures/nacl-pitzer-benchmark.json"
NIST_NACL_GRAM_PER_MOL = 58.443
OUTPUT = """SELECTED_OUTPUT
  -reset false
  -high_precision true
USER_PUNCH
  -headings volumeL sodiumMoles chlorideMoles haliteMoles haliteSi
  -start
  10 PUNCH SOLN_VOL, MOL("Na+") * TOT("water"), MOL("Cl-") * TOT("water"), EQUI("Halite"), SI("Halite")
  -end
"""


def molarity(stock):
    value = float(stock["concentration"])
    return value / NIST_NACL_GRAM_PER_MOL if stock["unit"] == "g/L" else value


def liters(stock):
    value = float(stock["quantity"])
    return value / 1000 if stock["quantityUnit"] == "mL" else value


def reference_case(case, library, database):
    solver = IPhreeqc(str(library))
    solver.load_database(str(database))
    if solver.get_error_string().strip():
        raise RuntimeError(solver.get_error_string())

    stocks = case["stocks"]
    # PHREEQC internally uses molality. Scale each PHREEQC solution to
    # its submitted aliquot using its own computed liquid volume.
    solutions = "".join(
        f"SOLUTION {number}\n  -temp 25\n  -units mol/L\n  -density 1 calculate\n  -water 1\n"
        f"  Na {molarity(stock):.17g}\n  Cl {molarity(stock):.17g}\n"
        for number, stock in enumerate(stocks, 1)
    )
    solver.run_string(OUTPUT + solutions + "END\n")
    _, stock_a, stock_b = solver.get_selected_output_array()
    fraction_a = liters(stocks[0]) / stock_a[0]
    fraction_b = liters(stocks[1]) / stock_b[0]
    solver.run_string(
        f"MIX 3\n  1 {fraction_a:.17g}\n  2 {fraction_b:.17g}\n"
        "EQUILIBRIUM_PHASES 3\n  Halite 0 0\nEND\n"
    )
    _, final = solver.get_selected_output_array()
    _, sodium, chloride, halite, halite_si = final
    measured_volume = case["finalVolumeMl"] / 1000
    return {
        "sodium": {"amountMol": sodium, "concentrationMolL": sodium / measured_volume},
        "chloride": {"amountMol": chloride, "concentrationMolL": chloride / measured_volume},
        "haliteMoles": halite,
        "haliteSi": halite_si,
    }


def verify(expected, actual):
    for key, value in actual.items():
        if isinstance(value, dict):
            verify(expected[key], value)
        elif not math.isclose(expected[key], value, rel_tol=1e-8, abs_tol=1e-16):
            raise ValueError(f"{key}: expected {expected[key]}, got {value}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("library", type=Path, help="Path to the IPhreeqc 3.7.3-15968 shared library.")
    parser.add_argument("database", type=Path, help="Path to pitzer.dat from the matching USGS release.")
    parser.add_argument("--write", action="store_true", help="Regenerate the checked-in benchmark values.")
    args = parser.parse_args()
    library = args.library.resolve()
    database = args.database.resolve()
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    source = fixture["reference"]
    get_version = ctypes.CDLL(str(library)).GetVersionString
    get_version.restype = ctypes.c_char_p
    version = get_version().decode("ascii")
    if version != source["engineVersion"] and not version.startswith(source["engineVersion"] + "-"):
        raise ValueError(f"Expected {source['engineVersion']}, got {version}")
    digest = hashlib.sha256(database.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    if digest != source["databaseSha256Lf"]:
        raise ValueError(f"Unexpected pitzer.dat SHA-256: {digest}")

    for case in fixture["cases"]:
        result = reference_case(case, library, database)
        if not (result["haliteMoles"] == 0 and result["haliteSi"] < 0):
            raise ValueError(f"Reference requires an undersaturated liquid: {case['id']}")
        if args.write:
            case.update(result)
        else:
            verify(case, result)
        print(f"PHREEQC {version}: {case['id']} verified")
    if args.write:
        FIXTURE.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
