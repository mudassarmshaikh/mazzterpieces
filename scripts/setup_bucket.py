"""
Run this once to create the S3 bucket for CloudPix.
Usage:
  cd scripts
  python setup_bucket.py
"""
import os
import sys

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "../backend/.env"))

REGION = os.getenv("AWS_REGION", "us-east-1")
BUCKET = os.getenv("S3_BUCKET_NAME", "cloudpix-photos")

s3 = boto3.client(
    "s3",
    region_name=REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
)


def create_bucket():
    try:
        if REGION == "us-east-1":
            s3.create_bucket(Bucket=BUCKET)
        else:
            s3.create_bucket(
                Bucket=BUCKET,
                CreateBucketConfiguration={"LocationConstraint": REGION},
            )
        print(f"Bucket '{BUCKET}' created in {REGION}.")
    except ClientError as e:
        code = e.response["Error"]["Code"]
        if code in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
            print(f"Bucket '{BUCKET}' already exists.")
        else:
            print(f"Error: {e}")
            sys.exit(1)

    # Block all public access
    s3.put_public_access_block(
        Bucket=BUCKET,
        PublicAccessBlockConfiguration={
            "BlockPublicAcls": True,
            "IgnorePublicAcls": True,
            "BlockPublicPolicy": True,
            "RestrictPublicBuckets": True,
        },
    )
    print("Public access blocked. Images served via presigned URLs only.")


if __name__ == "__main__":
    create_bucket()
